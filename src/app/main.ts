import '../styles/style.css';

import type {
  AgeProfile,
  BoosterKind,
  BotSnake,
  BrainQuest,
  Difficulty,
  FairySkillKind,
  GameAction,
  GameMode,
  GameState,
  GuardianFairyKind,
  GuardianFairyState,
  Hazard,
  QuestKind,
  SnakeForm,
  Vec2,
  VisualTheme,
} from '../core/types';
import {
  buildStraightSpine,
  clamp,
  computeLeaderboard,
  createInitialState,
  euclideanDistance,
  normalizeAngle,
  powerFormForSkin,
  reduce,
  SEGMENT_SPACING,
  targetBotSpineLength,
} from '../core';
import { GameRenderer } from '../rendering';
import { SoundEngine, VoiceHelper } from '../audio';
import {
  DualSenseManager,
  attachKeyboard,
  attachSwipe,
  createTouchControls,
  type ControlHandlers,
} from '../input';
import { GameUI, type GameUICallbacks } from '../ui';
import {
  DEFAULT_PLAYER_NAME,
  loadBest,
  loadNickname,
  loadOrCreateNickname,
  loadPlayerId,
  loadSettings,
  saveBest,
  saveNickname,
  saveSettings,
  type Settings,
} from '../platform/storage';
import { AchievementTracker } from './achievementTracker';
import { recordDailyPlay } from '../platform/daily';
import { submitScore } from '../platform/leaderboard';
import {
  evaluateLeaderboardAchievements,
  evaluateStreakAchievements,
  loadUnlockedAchievements,
} from '../platform/achievements';
import { spawnQuest } from '../core/quests';
import { spawnGuardianFairyNow } from '../core/guardianFairy';

/** Fraction of a tick after which a fresh turn snaps forward for crisp steering. */
const STEP_AHEAD = 0.5;
/** Fixed sub-tick step (ms) for magical projectiles. */
const PROJECTILE_STEP_MS = 55;
/** Clamp frame delta (ms) when resuming from a backgrounded tab. */
const MAX_FRAME_DELTA_MS = 250;
/** Cap logic simulation steps per animation frame to prevent spiral-of-death stalls. */
const MAX_STEPS_PER_FRAME = 4;

/** Public E2E/debug bridge exposed on `window.__snakeGame`. */
export interface SnakeGameTestHook {
  readonly getState: () => GameState;
  readonly placeEdibleBotAheadForTest: () => number;
  readonly placeFrostTargetsAheadForTest?: () => {
    readonly botId: number;
    readonly hazardId: number;
  } | null;
  readonly spawnQuestForTest: (kind?: QuestKind) => BrainQuest | null;
  readonly spawnGuardianFairyForTest?: (kind?: GuardianFairyKind) => GuardianFairyState | null;
}

declare global {
  interface Window {
    __snakeGame?: SnakeGameTestHook;
  }
}

function bootstrap(): void {
  const appRoot = document.getElementById('app');
  const uiRoot = document.getElementById('ui');
  if (!appRoot || !uiRoot) {
    throw new Error('Missing #app or #ui mount point');
  }

  let currentSettings: Settings = loadSettings();
  const playerId = loadPlayerId();
  const savedNickname = loadNickname();
  const initialPlayerName =
    savedNickname ?? currentSettings.playerName?.trim() ?? loadOrCreateNickname();
  if (currentSettings.playerName !== initialPlayerName) {
    currentSettings = { ...currentSettings, playerName: initialPlayerName };
    saveSettings(currentSettings);
  }

  let state: GameState = createInitialState({
    mode: currentSettings.mode,
    difficulty: currentSettings.difficulty,
    playerName: initialPlayerName,
    best: loadBest(),
    seed: Date.now() >>> 0,
    ageProfile: currentSettings.ageProfile,
  });

  const renderer = new GameRenderer(appRoot, state.config);
  renderer.setTheme(currentSettings.theme);

  const sound = new SoundEngine({
    soundEnabled: currentSettings.sound,
    musicEnabled: currentSettings.music,
  });

  const voice = new VoiceHelper();
  voice.setEnabled(currentSettings.sound);

  let acc = 0;
  let projAcc = 0;
  let lastHandledEventId = 0;

  /** Simulation runs at fixed 50ms ticks (`config.baseTick`) alongside 55ms projectile steps. */
  const effectiveTickInterval = (): number => Math.max(45, state.tickInterval);

  const sanitizePlayerName = (name?: string): string => {
    const trimmed = name?.trim().slice(0, 16) ?? '';
    return trimmed.length > 0 ? trimmed : DEFAULT_PLAYER_NAME;
  };

  const persistSelection = (
    mode: GameMode,
    difficulty: Difficulty,
    playerName?: string,
    ageProfile?: AgeProfile,
  ): string => {
    const cleanName = sanitizePlayerName(playerName);
    const age = ageProfile ?? currentSettings.ageProfile;
    if (
      currentSettings.mode !== mode ||
      currentSettings.difficulty !== difficulty ||
      currentSettings.playerName !== cleanName ||
      currentSettings.ageProfile !== age
    ) {
      currentSettings = {
        ...currentSettings,
        mode,
        difficulty,
        playerName: cleanName,
        ageProfile: age,
      };
      saveSettings(currentSettings);
    }
    if (loadNickname() !== cleanName) {
      saveNickname(cleanName);
    }
    return cleanName;
  };

  const startFromSelection = (
    mode: GameMode,
    difficulty: Difficulty,
    playerName?: string,
    ageProfile?: AgeProfile,
  ): void => {
    const cleanName = persistSelection(
      mode,
      difficulty,
      playerName ?? ui.getSelectedPlayerName(),
      ageProfile,
    );
    const age = ageProfile ?? currentSettings.ageProfile;
    if (state.phase === 'paused') {
      dispatch({ type: 'reset', mode, difficulty, playerName: cleanName, ageProfile: age });
    }
    dispatch({ type: 'start', mode, difficulty, playerName: cleanName, ageProfile: age });
  };

  const restartFromSelection = (
    mode: GameMode,
    difficulty: Difficulty,
    playerName?: string,
    ageProfile?: AgeProfile,
  ): void => {
    const cleanName = persistSelection(
      mode,
      difficulty,
      playerName ?? ui.getSelectedPlayerName(),
      ageProfile,
    );
    const age = ageProfile ?? currentSettings.ageProfile;
    dispatch({ type: 'reset', mode, difficulty, playerName: cleanName, ageProfile: age });
    dispatch({ type: 'start', mode, difficulty, playerName: cleanName, ageProfile: age });
  };

  // --- Controls (DualSense + Keyboard + Touch) -------------------------------
  const controls: ControlHandlers = {
    steer(angle) {
      if (angle !== null) sound.unlock();
      if (state.phase === 'playing') {
        dispatch({ type: 'steer', angle });
      }
    },
    turn(direction) {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'turn', direction });
      const stepTick = effectiveTickInterval();
      if (acc >= stepTick * STEP_AHEAD) acc = stepTick;
    },
    primary() {
      sound.unlock();
      if (state.phase === 'ready') {
        startFromSelection(
          ui.getSelectedMode(),
          ui.getSelectedDifficulty(),
          ui.getSelectedPlayerName(),
          ui.getSelectedAgeProfile(),
        );
      } else if (state.phase === 'paused') {
        dispatch({ type: 'resume' });
      } else if (state.phase === 'gameover') {
        restartFromSelection(
          ui.getSelectedMode(),
          ui.getSelectedDifficulty(),
          ui.getSelectedPlayerName(),
          ui.getSelectedAgeProfile(),
        );
      }
    },
    togglePause() {
      sound.unlock();
      if (state.phase === 'playing') {
        if (state.butterflyHold) {
          dispatch({ type: 'set_butterfly_hold', active: false });
        }
        dispatch({ type: 'pause' });
      } else if (state.phase === 'paused') dispatch({ type: 'resume' });
    },
    shoot() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'shoot' });
      ui.flashControlFeedback('shoot', state.form);
    },
    morphNext() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'morph', delta: 1 });
      ui.flashControlFeedback('morph', state.form);
    },
    morphPrev() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'morph', delta: -1 });
      ui.flashControlFeedback('morph', state.form);
    },
    morphTo(form: SnakeForm) {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'morph', form });
      ui.flashControlFeedback('morph', state.form);
    },
    setDash(active: boolean) {
      if (active) sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'dash', active });
      if (active) ui.flashControlFeedback('dash');
    },
    shield() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'shield' });
      ui.flashControlFeedback('shield');
    },
    activateBooster(booster: BoosterKind) {
      sound.unlock();
      if (state.phase === 'playing') {
        dispatch({ type: 'activate_booster', booster });
        ui.flashControlFeedback('booster', booster);
      }
    },
    castFairySkill(skill: FairySkillKind) {
      sound.unlock();
      if (state.phase === 'playing') {
        dispatch({ type: 'cast_fairy_skill', skill });
        ui.flashControlFeedback('skill', skill);
      }
    },
    setButterflyHold(active: boolean) {
      if (active) sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'set_butterfly_hold', active });
      if (active) ui.flashControlFeedback('skill', 'butterfly');
    },
    togglePrincess() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      if (state.butterflyHold) {
        dispatch({ type: 'set_butterfly_hold', active: false });
      }
      dispatch({ type: 'toggle_princess' });
      ui.flashControlFeedback('princess');
    },
    cameraLook(nx: number, ny: number) {
      renderer.setCameraLook(nx, ny);
    },
  };

  const dualsense = new DualSenseManager(controls);
  dualsense.setVibrationEnabled(currentSettings.vibration);

  const uiCallbacks: GameUICallbacks = {
    onStartGame(mode, difficulty, playerName, ageProfile) {
      sound.unlock();
      startFromSelection(mode, difficulty, playerName, ageProfile);
    },
    onResumeGame() {
      sound.unlock();
      dispatch({ type: 'resume' });
    },
    onRestartGame() {
      sound.unlock();
      restartFromSelection(
        ui.getSelectedMode(),
        ui.getSelectedDifficulty(),
        ui.getSelectedPlayerName(),
        ui.getSelectedAgeProfile(),
      );
    },
    onTogglePause() {
      controls.togglePause();
    },
    onSelectForm(form) {
      sound.unlock();
      dispatch({ type: 'morph', form });
      ui.flashControlFeedback('morph', state.form);
    },
    onActivateBooster(booster) {
      controls.activateBooster(booster);
    },
    onSelectTheme(theme: VisualTheme) {
      sound.unlock();
      currentSettings = { ...currentSettings, theme };
      saveSettings(currentSettings);
      renderer.setTheme(theme);
    },
    onToggleSound(enabled) {
      sound.unlock();
      currentSettings = { ...currentSettings, sound: enabled };
      saveSettings(currentSettings);
      sound.setSoundEnabled(enabled);
      voice.setEnabled(enabled);
    },
    onToggleMusic(enabled) {
      sound.unlock();
      currentSettings = { ...currentSettings, music: enabled };
      saveSettings(currentSettings);
      sound.setMusicEnabled(enabled);
    },
    onToggleVibration(enabled) {
      sound.unlock();
      currentSettings = { ...currentSettings, vibration: enabled };
      saveSettings(currentSettings);
      dualsense.setVibrationEnabled(enabled);
    },
    onConnectWebHid() {
      sound.unlock();
      return dualsense.connectWebHid(state.form);
    },
    onSelectAgeProfile(ageProfile: AgeProfile) {
      sound.unlock();
      currentSettings = { ...currentSettings, ageProfile };
      saveSettings(currentSettings);
      dispatch({ type: 'set_age_profile', ageProfile });
      ui.getOverlay().setAgeProfile(ageProfile);
    },
    onCastFairySkill(skill: FairySkillKind) {
      controls.castFairySkill(skill);
    },
    onButterflyHold(active: boolean) {
      controls.setButterflyHold(active);
    },
    onSpeakQuest() {
      voice.speakQuest(state.quest);
    },
    onTogglePrincess() {
      controls.togglePrincess();
    },
  };

  const ui = new GameUI(uiRoot, uiCallbacks, currentSettings);
  const achievementTracker = new AchievementTracker((defs) => {
    for (const def of defs) {
      ui.showToast(`🏆 Danh hiệu: ${def.name}`, def.description, def.icon ?? '🏆');
    }
  });

  // --- Side-effecting reducer dispatch --------------------------------------
  function onStateChange(prev: GameState, next: GameState): void {
    for (const ev of next.events) {
      if (ev.id <= lastHandledEventId) continue;
      lastHandledEventId = ev.id;
      sound.onEvent(ev, next);
      renderer.onEvent(ev, next);
      dualsense.onEvent(ev, next);
      voice.onEvent(ev, next);
      const screenPos = ev.cell ? renderer.projectCell(ev.cell) : null;
      ui.onEvent(ev, next, screenPos);
    }

    sound.updateMusicState(next);
    achievementTracker.onStateChange(prev, next);

    if (next.best > prev.best || (next.phase === 'gameover' && prev.phase !== 'gameover')) {
      saveBest(next.best);
    }

    if (next.phase === 'gameover' && prev.phase !== 'gameover') {
      const nickname = next.playerName || loadOrCreateNickname();
      void submitScore('alltime', next.difficulty, next.score, {
        id: playerId,
        nickname,
      }).then(({ rank }) => {
        const unlocked = loadUnlockedAchievements();
        achievementTracker.applyUnlocks(evaluateLeaderboardAchievements(rank, unlocked));
      });

      const streak = recordDailyPlay();
      const unlocked = loadUnlockedAchievements();
      achievementTracker.applyUnlocks(evaluateStreakAchievements(streak.count, unlocked));
    }

    if (next.phase === 'playing' && (prev.phase === 'ready' || prev.phase === 'gameover')) {
      acc = 0;
      projAcc = 0;
    }

    ui.syncState(next);

    const needsFullSync =
      next.snake !== prev.snake ||
      next.bots !== prev.bots ||
      next.chompStreak !== prev.chompStreak ||
      next.orbs !== prev.orbs ||
      next.phase !== prev.phase ||
      next.form !== prev.form ||
      next.level !== prev.level ||
      next.playerName !== prev.playerName ||
      next.playerRank !== prev.playerRank ||
      next.arenaMargin !== prev.arenaMargin ||
      next.pendingShrink !== prev.pendingShrink ||
      next.config !== prev.config ||
      next.butterflyStage !== prev.butterflyStage ||
      next.princessStage !== prev.princessStage ||
      next.sprayActiveTicks !== prev.sprayActiveTicks;

    if (needsFullSync) {
      renderer.sync(next);
    } else if (
      next.projectiles !== prev.projectiles ||
      next.hostileProjectiles !== prev.hostileProjectiles ||
      next.hazards !== prev.hazards ||
      next.quest !== prev.quest ||
      next.food !== prev.food ||
      next.bonusFood !== prev.bonusFood ||
      next.gardenFlowers !== prev.gardenFlowers ||
      next.lightningBolts !== prev.lightningBolts ||
      next.aoeBlasts !== prev.aoeBlasts ||
      next.silkWebs !== prev.silkWebs ||
      next.frostZones !== prev.frostZones ||
      next.guardianFairy !== prev.guardianFairy
    ) {
      renderer.syncProjectiles(next);
    }
  }

  function dispatch(action: GameAction): void {
    const prev = state;
    state = reduce(state, action);
    if (state !== prev) onStateChange(prev, state);
  }

  // --- Attach input adapters & initial paint --------------------------------
  const detachKeyboard = attachKeyboard(controls);
  const detachTouch = createTouchControls(uiRoot, controls);
  const detachSwipe = attachSwipe(appRoot, controls);

  const unlockAudioOnGesture = (): void => {
    sound.unlock();
  };
  window.addEventListener('pointerdown', unlockAudioOnGesture, { passive: true });
  window.addEventListener('keydown', unlockAudioOnGesture, { passive: true });

  function placeEdibleBotAheadForTest(): number {
    if (state.phase !== 'playing') return 0;
    const playerHead = state.snake[0];
    if (!playerHead) return 0;

    const botLevel = 3;
    const segmentCount = targetBotSpineLength(botLevel, false);
    const heading = normalizeAngle(state.heading);
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const tailDist = 1.5;
    const headDist = tailDist + (segmentCount - 1) * SEGMENT_SPACING;
    const safeBound = Math.max(4, state.config.worldRadius - 2.5);
    const botHead: Vec2 = {
      x: clamp(playerHead.x + fx * headDist, -safeBound, safeBound),
      z: clamp(playerHead.z + fz * headDist, -safeBound, safeBound),
    };
    const spine = buildStraightSpine(botHead, heading, segmentCount);
    const prevSpine = spine.map((p) => ({ ...p }));
    const maxBotId = state.bots.reduce((max, b) => Math.max(max, b.id), 0);
    const testBot: BotSnake = {
      id: maxBotId + 1000,
      name: 'Bot Test Nhí',
      skin: 'gold_armor',
      isBoss: false,
      level: botLevel,
      maxLevel: botLevel,
      chompedTicks: 0,
      bittenSegments: 0,
      head: botHead,
      prevHead: { ...botHead },
      heading,
      spine,
      prevSpine,
      frozenTicks: 16,
      powerForm: powerFormForSkin('gold_armor'),
    };

    const farBots = state.bots.filter(
      (b) =>
        euclideanDistance(b.head, playerHead) >= 24 &&
        euclideanDistance(b.head, botHead) >= 24 &&
        b.spine.every(
          (seg) =>
            euclideanDistance(seg, playerHead) >= 22 && euclideanDistance(seg, botHead) >= 22,
        ),
    );
    const nextBots: readonly BotSnake[] = [testBot, ...farBots];
    const activeBossId =
      state.activeBossId !== null && nextBots.some((b) => b.id === state.activeBossId)
        ? state.activeBossId
        : null;
    const board = computeLeaderboard({
      playerName: state.playerName,
      playerLevel: state.level,
      bots: nextBots,
      activeBossId,
    });

    state = {
      ...state,
      targetHeading: null,
      bots: nextBots,
      activeBossId,
      hazards: state.hazards.filter(
        (h) =>
          euclideanDistance(h.cell, playerHead) >= 12 && euclideanDistance(h.cell, botHead) >= 12,
      ),
      orbs: state.orbs.filter(
        (o) => !spine.some((seg) => Math.hypot(o.x - seg.x, o.z - seg.z) < 2.0),
      ),
      chompStreak: 0,
      chompStreakTicks: 0,
      leaderboard: board.leaderboard,
      playerRank: board.playerRank,
      crownTarget: board.crownTarget,
      config: {
        ...state.config,
        botCount: Math.max(1, nextBots.length),
      },
    };
    renderer.sync(state);
    ui.syncState(state);
    return testBot.spine.length;
  }

  function placeFrostTargetsAheadForTest(): {
    readonly botId: number;
    readonly hazardId: number;
  } | null {
    if (state.phase !== 'playing') return null;
    const playerHead = state.snake[0];
    if (!playerHead) return null;

    const heading = normalizeAngle(state.heading);
    const fx = Math.cos(heading);
    const fz = Math.sin(heading);
    const px = -fz;
    const pz = fx;
    const safeBound = Math.max(4, state.config.worldRadius - 3);

    const botHead: Vec2 = {
      x: clamp(playerHead.x + px * 4.2 + fx * 1.4, -safeBound, safeBound),
      z: clamp(playerHead.z + pz * 4.2 + fz * 1.4, -safeBound, safeBound),
    };
    const botLevel = 3;
    const segmentCount = targetBotSpineLength(botLevel, false);
    const spine = buildStraightSpine(botHead, heading, segmentCount);
    const prevSpine = spine.map((p) => ({ ...p }));
    const botId = state.bots.reduce((max, b) => Math.max(max, b.id), 0) + 1001;
    const frostBot: BotSnake = {
      id: botId,
      name: 'Bot Băng Test',
      skin: 'gold_armor',
      isBoss: false,
      level: botLevel,
      maxLevel: botLevel,
      chompedTicks: 0,
      bittenSegments: 0,
      head: botHead,
      prevHead: { ...botHead },
      heading,
      spine,
      prevSpine,
      frozenTicks: 0,
      powerForm: powerFormForSkin('gold_armor'),
    };

    const hazardCell: Vec2 = {
      x: clamp(playerHead.x - px * 4.2 + fx * 1.4, -safeBound, safeBound),
      z: clamp(playerHead.z - pz * 4.2 + fz * 1.4, -safeBound, safeBound),
    };
    const hazardId = state.hazards.reduce((max, h) => Math.max(max, h.id), 0) + 1001;
    const frostHazard: Hazard = {
      id: hazardId,
      cell: hazardCell,
      prevCell: { ...hazardCell },
      kind: 'slime',
      hp: 2,
      maxHp: 2,
      frozenTicks: 0,
      warningTicks: 0,
    };

    const nextBots: readonly BotSnake[] = [frostBot, ...state.bots];
    const nextHazards: readonly Hazard[] = [frostHazard, ...state.hazards];
    const board = computeLeaderboard({
      playerName: state.playerName,
      playerLevel: state.level,
      bots: nextBots,
      activeBossId: state.activeBossId,
    });

    state = {
      ...state,
      bots: nextBots,
      hazards: nextHazards,
      leaderboard: board.leaderboard,
      playerRank: board.playerRank,
      crownTarget: board.crownTarget,
      config: {
        ...state.config,
        botCount: Math.max(1, nextBots.length),
      },
    };
    renderer.sync(state);
    ui.syncState(state);
    return { botId, hazardId };
  }

  function spawnQuestForTest(kind?: QuestKind): BrainQuest | null {
    if (state.phase !== 'playing') return null;
    const spawned = spawnQuest(state, state.rng, kind);
    if (!spawned.quest) return null;

    state = {
      ...state,
      quest: spawned.quest,
      rng: spawned.rng,
    };
    renderer.sync(state);
    ui.syncState(state);
    return spawned.quest;
  }

  function spawnGuardianFairyForTest(kind?: GuardianFairyKind): GuardianFairyState | null {
    if (state.phase !== 'playing') return null;
    const prev = state;
    const next = spawnGuardianFairyNow(prev, kind);
    if (next === prev) return null;
    state = next;
    onStateChange(prev, next);
    return state.guardianFairy;
  }

  window.__snakeGame = {
    getState: () => state,
    placeEdibleBotAheadForTest,
    placeFrostTargetsAheadForTest,
    spawnQuestForTest,
    spawnGuardianFairyForTest,
  };

  renderer.sync(state);
  ui.syncState(state);
  sound.updateMusicState(state);

  // --- 60fps simulation & interpolated rendering loop -----------------------
  let lastFrame = performance.now();
  let rafId = 0;

  const projectWorld = (x: number, z: number, out: { x: number; y: number }): boolean =>
    renderer.projectWorld(x, z, out);

  function frame(now: number): void {
    rafId = requestAnimationFrame(frame);

    const dtMs = Math.min(Math.max(0, now - lastFrame), MAX_FRAME_DELTA_MS);
    lastFrame = now;

    const controllerStatus = dualsense.poll(dtMs, state);
    ui.syncController(controllerStatus);
    if (controllerStatus.pressedLabels.length > 0) {
      sound.unlock();
    }

    let alpha = 1;
    let projectileAlpha = 1;

    if (state.phase === 'playing') {
      acc += dtMs;
      let tickSteps = 0;
      while (state.phase === 'playing' && tickSteps < MAX_STEPS_PER_FRAME) {
        const stepTick = effectiveTickInterval();
        if (acc < stepTick) break;
        acc -= stepTick;
        tickSteps++;
        dispatch({ type: 'tick' });
      }
      if (tickSteps >= MAX_STEPS_PER_FRAME) {
        const capTick = effectiveTickInterval();
        if (acc >= capTick) acc %= capTick;
      }

      projAcc += dtMs;
      let projSteps = 0;
      while (
        state.phase === 'playing' &&
        projAcc >= PROJECTILE_STEP_MS &&
        projSteps < MAX_STEPS_PER_FRAME
      ) {
        projAcc -= PROJECTILE_STEP_MS;
        projSteps++;
        dispatch({ type: 'projectile_step', dtMs: PROJECTILE_STEP_MS });
      }
      if (projSteps >= MAX_STEPS_PER_FRAME && projAcc >= PROJECTILE_STEP_MS) {
        projAcc %= PROJECTILE_STEP_MS;
      }

      if (state.phase === 'playing') {
        alpha = Math.min(1, acc / effectiveTickInterval());
        projectileAlpha = Math.min(1, projAcc / PROJECTILE_STEP_MS);
      }
    }

    renderer.draw(alpha, projectileAlpha, now / 1000, dtMs / 1000, state);
    ui.updateSurvivalThreats(state, projectWorld);
  }

  rafId = requestAnimationFrame(frame);

  // --- Viewport resize & lifecycle cleanup ----------------------------------
  const handleResize = (): void => renderer.resize();
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  window.visualViewport?.addEventListener('resize', handleResize);

  const cleanup = (): void => {
    cancelAnimationFrame(rafId);
    delete window.__snakeGame;
    window.removeEventListener('pointerdown', unlockAudioOnGesture);
    window.removeEventListener('keydown', unlockAudioOnGesture);
    window.removeEventListener('resize', handleResize);
    window.removeEventListener('orientationchange', handleResize);
    window.visualViewport?.removeEventListener('resize', handleResize);
    detachKeyboard();
    detachTouch();
    detachSwipe();
    dualsense.dispose();
    sound.dispose();
    voice.cancel();
    ui.dispose();
    renderer.dispose();
  };

  window.addEventListener('beforeunload', cleanup, { once: true });
}

bootstrap();
