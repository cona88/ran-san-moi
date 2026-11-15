import '../styles/style.css';

import type {
  BoosterKind,
  Difficulty,
  GameAction,
  GameMode,
  GameState,
  SnakeForm,
  VisualTheme,
} from '../core/types';
import { createInitialState, reduce } from '../core';
import { GameRenderer } from '../rendering';
import { SoundEngine } from '../audio';
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

/** Fraction of a tick after which a fresh turn snaps forward for crisp steering. */
const STEP_AHEAD = 0.5;
/** Fixed sub-tick step (ms) for magical projectiles. */
const PROJECTILE_STEP_MS = 55;
/** Clamp frame delta (ms) when resuming from a backgrounded tab. */
const MAX_FRAME_DELTA_MS = 250;
/** Cap logic simulation steps per animation frame to prevent spiral-of-death stalls. */
const MAX_STEPS_PER_FRAME = 4;

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
  });

  const renderer = new GameRenderer(appRoot, state.config);
  renderer.setTheme(currentSettings.theme);

  const sound = new SoundEngine({
    soundEnabled: currentSettings.sound,
    musicEnabled: currentSettings.music,
  });

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
  ): string => {
    const cleanName = sanitizePlayerName(playerName);
    if (
      currentSettings.mode !== mode ||
      currentSettings.difficulty !== difficulty ||
      currentSettings.playerName !== cleanName
    ) {
      currentSettings = { ...currentSettings, mode, difficulty, playerName: cleanName };
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
  ): void => {
    const cleanName = persistSelection(mode, difficulty, playerName ?? ui.getSelectedPlayerName());
    if (state.phase === 'paused') {
      dispatch({ type: 'reset', mode, difficulty, playerName: cleanName });
    }
    dispatch({ type: 'start', mode, difficulty, playerName: cleanName });
  };

  const restartFromSelection = (
    mode: GameMode,
    difficulty: Difficulty,
    playerName?: string,
  ): void => {
    const cleanName = persistSelection(mode, difficulty, playerName ?? ui.getSelectedPlayerName());
    dispatch({ type: 'reset', mode, difficulty, playerName: cleanName });
    dispatch({ type: 'start', mode, difficulty, playerName: cleanName });
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
        );
      } else if (state.phase === 'paused') {
        dispatch({ type: 'resume' });
      } else if (state.phase === 'gameover') {
        restartFromSelection(
          ui.getSelectedMode(),
          ui.getSelectedDifficulty(),
          ui.getSelectedPlayerName(),
        );
      }
    },
    togglePause() {
      sound.unlock();
      if (state.phase === 'playing') dispatch({ type: 'pause' });
      else if (state.phase === 'paused') dispatch({ type: 'resume' });
    },
    shoot() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'shoot' });
    },
    morphNext() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'morph', delta: 1 });
    },
    morphPrev() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'morph', delta: -1 });
    },
    morphTo(form: SnakeForm) {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'morph', form });
    },
    setDash(active: boolean) {
      if (active) sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'dash', active });
    },
    shield() {
      sound.unlock();
      if (state.phase !== 'playing') return;
      dispatch({ type: 'shield' });
    },
    activateBooster(booster: BoosterKind) {
      sound.unlock();
      if (state.phase === 'playing') {
        dispatch({ type: 'activate_booster', booster });
      }
    },
    cameraLook(nx: number, ny: number) {
      renderer.setCameraLook(nx, ny);
    },
  };

  const dualsense = new DualSenseManager(controls);
  dualsense.setVibrationEnabled(currentSettings.vibration);

  const uiCallbacks: GameUICallbacks = {
    onStartGame(mode, difficulty, playerName) {
      sound.unlock();
      startFromSelection(mode, difficulty, playerName);
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
      );
    },
    onTogglePause() {
      controls.togglePause();
    },
    onSelectForm(form) {
      sound.unlock();
      dispatch({ type: 'morph', form });
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
      next.orbs !== prev.orbs ||
      next.phase !== prev.phase ||
      next.form !== prev.form ||
      next.level !== prev.level ||
      next.playerName !== prev.playerName ||
      next.playerRank !== prev.playerRank ||
      next.arenaMargin !== prev.arenaMargin ||
      next.pendingShrink !== prev.pendingShrink ||
      next.config !== prev.config;

    if (needsFullSync) {
      renderer.sync(next);
    } else if (
      next.projectiles !== prev.projectiles ||
      next.hazards !== prev.hazards ||
      next.quest !== prev.quest ||
      next.food !== prev.food ||
      next.bonusFood !== prev.bonusFood
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

  renderer.sync(state);
  ui.syncState(state);
  sound.updateMusicState(state);

  // --- 60fps simulation & interpolated rendering loop -----------------------
  let lastFrame = performance.now();
  let rafId = 0;

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
  }

  rafId = requestAnimationFrame(frame);

  // --- Viewport resize & lifecycle cleanup ----------------------------------
  const handleResize = (): void => renderer.resize();
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  window.visualViewport?.addEventListener('resize', handleResize);

  const cleanup = (): void => {
    cancelAnimationFrame(rafId);
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
    ui.dispose();
    renderer.dispose();
  };

  window.addEventListener('beforeunload', cleanup, { once: true });
}

bootstrap();
