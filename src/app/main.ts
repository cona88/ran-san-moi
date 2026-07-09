import '../styles/style.css';

import type { GameAction, GameState } from '../core/types';
import { configFor, createInitialState, reduce } from '../core';
import { GameRenderer } from '../rendering';
import { Sfx } from '../audio/sfx';
import { attachKeyboard } from '../input/keyboard';
import { attachSwipe, createTouchControls } from '../input/touch';
import type { ControlHandlers } from '../input/controls';
import { Toolbar } from '../ui/toolbar';
import { Overlay } from '../ui/overlay';
import { ScorePopups } from '../ui/popups';
import { SettingsPanel } from '../ui/settings';
import { loadBest, loadSettings, saveBest, saveSettings, type Settings } from '../platform/storage';

/** Fraction of a tick after which a fresh turn snaps forward for responsiveness. */
const STEP_AHEAD = 0.5;

function bootstrap(): void {
  const appRoot = document.getElementById('app');
  const uiRoot = document.getElementById('ui');
  if (!appRoot || !uiRoot) {
    throw new Error('Missing #app or #ui mount point');
  }

  const settings = loadSettings();
  let activeDifficulty = settings.difficulty;
  let state: GameState = createInitialState({
    config: configFor(settings.difficulty),
    best: loadBest(),
    seed: Date.now() >>> 0,
  });

  const renderer = new GameRenderer(appRoot, state.config);
  const sfx = new Sfx(settings.sound);
  const popups = new ScorePopups(uiRoot);

  // --- side-effecting dispatch ------------------------------------------------
  let acc = 0; // accumulated milliseconds toward the next tick

  function dispatch(action: GameAction): void {
    const prev = state;
    state = reduce(state, action);
    if (state !== prev) onStateChange(prev, state);
  }

  function onStateChange(prev: GameState, next: GameState): void {
    if (next.score > prev.score) {
      sfx.eat();
      // Celebrate at the spot of the food that was just eaten (prev.food).
      const spot = renderer.projectCell(prev.food);
      if (spot) popups.spawn(spot.x, spot.y);
    }
    if (next.phase === 'gameover' && prev.phase !== 'gameover') {
      sfx.crash();
      saveBest(next.best);
    }

    if (next.phase !== prev.phase) {
      if (next.phase === 'playing') {
        // Start fresh from a full tick, but keep the accumulator when merely
        // resuming from pause so a pause never silently advances the snake.
        if (prev.phase === 'ready' || prev.phase === 'gameover') acc = 0;
        overlay.hide();
      } else if (next.phase === 'paused') overlay.showPaused();
      else if (next.phase === 'ready') overlay.showReady();
      else if (next.phase === 'gameover') {
        overlay.showGameOver(next.score, next.score >= next.best && next.score > 0, next.won);
      }
    }

    toolbar.setScore(next.score);
    toolbar.setBest(next.best);

    // Only re-sync the renderer when the snake actually advanced (a moved array
    // is a new reference) or on game over — never on a mere queued turn, which
    // would otherwise freeze the interpolation mid-tick.
    if (next.snake !== prev.snake || next.phase === 'gameover') {
      renderer.sync(next);
    }
  }

  // --- controls ---------------------------------------------------------------
  const controls: ControlHandlers = {
    turn(direction) {
      if (state.phase !== 'playing') return;
      dispatch({ type: 'turn', direction });
      if (acc >= state.tickInterval * STEP_AHEAD) acc = state.tickInterval;
    },
    primary() {
      sfx.resume();
      if (state.phase === 'paused') dispatch({ type: 'resume' });
      else if (state.phase !== 'playing') dispatch({ type: 'start' });
    },
    togglePause() {
      if (state.phase === 'playing') dispatch({ type: 'pause' });
      else if (state.phase === 'paused') dispatch({ type: 'resume' });
    },
  };

  const overlay = new Overlay(uiRoot, controls.primary);
  const detachKeyboard = attachKeyboard(controls);
  createTouchControls(uiRoot, controls);
  attachSwipe(appRoot, controls);

  const settingsPanel = new SettingsPanel(uiRoot, settings, {
    onChange(next: Settings) {
      saveSettings(next);
      sfx.setEnabled(next.sound);
      if (next.difficulty !== activeDifficulty) {
        activeDifficulty = next.difficulty;
        startFreshGame(next);
      }
    },
    onVisibilityChange(open) {
      if (open && state.phase === 'playing') dispatch({ type: 'pause' });
    },
  });

  const toolbar = new Toolbar(uiRoot, {
    onLeaderboardClick: () => {
      /* wired in Task 16 */
    },
    onSettingsClick: () => settingsPanel.open(),
  });

  /** Rebuild the game when the difficulty changes; returns to the ready screen. */
  function startFreshGame(next: Settings): void {
    state = createInitialState({
      config: configFor(next.difficulty),
      best: state.best,
      seed: Date.now() >>> 0,
    });
    acc = 0;
    renderer.sync(state);
    toolbar.setScore(state.score);
    toolbar.setBest(state.best);
    overlay.showReady();
  }

  // --- initial paint ----------------------------------------------------------
  renderer.sync(state);
  toolbar.setScore(state.score);
  toolbar.setBest(state.best);
  overlay.showReady();

  // --- main loop (fixed-timestep simulation, interpolated render) -------------
  let lastFrame = performance.now();

  function frame(now: number): void {
    requestAnimationFrame(frame);
    const deltaMs = Math.min(now - lastFrame, 250); // clamp huge gaps (tab refocus)
    lastFrame = now;

    if (state.phase === 'playing') {
      acc += deltaMs;
      while (state.phase === 'playing' && acc >= state.tickInterval) {
        acc -= state.tickInterval;
        dispatch({ type: 'tick' });
      }
    }

    const alpha = state.phase === 'playing' ? Math.min(1, acc / state.tickInterval) : 1;
    renderer.draw(alpha, now / 1000, deltaMs / 1000, state);
  }
  requestAnimationFrame(frame);

  // Re-fit on every event that can change the viewport: window resize, device
  // rotation, and the mobile URL bar showing/hiding (visualViewport).
  const handleResize = (): void => renderer.resize();
  window.addEventListener('resize', handleResize);
  window.addEventListener('orientationchange', handleResize);
  window.visualViewport?.addEventListener('resize', handleResize);
  window.addEventListener('beforeunload', detachKeyboard);
}

bootstrap();
