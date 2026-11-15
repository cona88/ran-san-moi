import type { GameEvent, GameEventKind, GameState, SnakeForm } from '../core/types';

export type AudioContextCtor = typeof AudioContext;

/** Resolve the Web Audio `AudioContext` constructor safely across macOS Safari/Chrome and headless environments. */
export function getSafeAudioContextConstructor(): AudioContextCtor | null {
  if (typeof globalThis === 'undefined') return null;
  const g = globalThis as typeof globalThis & {
    AudioContext?: AudioContextCtor;
    webkitAudioContext?: AudioContextCtor;
  };
  return g.AudioContext ?? g.webkitAudioContext ?? null;
}

/** Smoothly transition an `AudioParam` without audible clicks or pops. */
export function smoothSetGain(
  param: AudioParam,
  target: number,
  now: number,
  timeConstant = 0.03,
): void {
  const safeTarget = Number.isFinite(target) ? Math.max(0, target) : 0;
  if (typeof param.cancelScheduledValues === 'function') {
    param.cancelScheduledValues(now);
  }
  if (typeof param.setValueAtTime === 'function') {
    param.setValueAtTime(param.value, now);
  }
  if (typeof param.setTargetAtTime === 'function') {
    param.setTargetAtTime(safeTarget, now, timeConstant);
  } else {
    param.value = safeTarget;
  }
}

/** Convert a MIDI note number to frequency in Hz. */
export function midiToHz(midi: number): number {
  return 440 * 2 ** ((midi - 69) / 12);
}

interface ToneSpec {
  readonly delay?: number;
  readonly startHz: number;
  readonly endHz?: number;
  readonly duration: number;
  readonly attack?: number;
  readonly gain: number;
  readonly type?: OscillatorType;
  readonly overtoneRatio?: number;
  readonly overtoneGain?: number;
  readonly filterHz?: number;
  readonly pitchMode?: 'exp' | 'linear';
}

const COMBO_PENTATONIC_SEMITONES: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

const MORPH_CHORDS: Record<SnakeForm, readonly number[]> = {
  dragon: [349.23, 440.0, 523.25, 659.25, 783.99], // Fmaj9 warm soaring
  phoenix: [392.0, 493.88, 587.33, 739.99, 987.77], // Bright icy shimmer
  unicorn: [392.0, 493.88, 587.33, 783.99, 1046.5], // Sparkling starlight harp
  spirit: [329.63, 392.0, 523.25, 587.33, 783.99], // Gentle woodland Cmaj9
};

/**
 * Synthesized magical sound effects via the Web Audio API — no external assets.
 *
 * Works standalone (backwards compatible with legacy `new Sfx(enabled)`) or
 * bound to a shared `AudioContext` and `sfxGain` managed by {@link SoundEngine}.
 */
export class Sfx {
  private context: AudioContext | null = null;
  private destination: AudioNode | null = null;
  private ownsContext = false;
  private enabled: boolean;
  private disposed = false;
  private noiseBuffer: AudioBuffer | null = null;
  private readonly lastPlayedAt = new Map<GameEventKind, number>();
  private lastFanfareAt = -1;
  private lastAlertAt = -1;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /** Attach a shared `AudioContext` and target gain bus owned by `SoundEngine`. */
  attachOutput(context: AudioContext, destination: AudioNode): void {
    if (this.disposed) return;
    if (this.context !== context) {
      this.noiseBuffer = null;
    }
    this.context = context;
    this.destination = destination;
    this.ownsContext = false;
  }

  /** Enable or mute sound effects. */
  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Unlock audio safely from within a user gesture. */
  resume(): void {
    if (this.disposed) return;
    const ctx = this.ensureContext();
    if (ctx && ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
  }

  /** Rising xylophone chime when food is eaten (standalone helper). */
  eat(): void {
    this.playEatFood(1);
  }

  /** Gentle encouraging cadence on game over (standalone helper). */
  crash(): void {
    this.playGameOver(false);
  }

  /** Play the magical sound effect corresponding to a {@link GameEvent}. */
  playEvent(event: GameEvent, state: GameState): void {
    if (this.disposed || !this.enabled) return;
    const ctx = this.ensureContext();
    if (!ctx || ctx.state === 'closed') return;

    const baseOffset = this.computeCascadeOffset(event.kind, ctx.currentTime);
    const kind: GameEventKind = event.kind;

    switch (kind) {
      case 'eat_food':
        this.playEatFood(state.combo, baseOffset);
        return;
      case 'eat_bonus':
        this.playEatBonus(baseOffset);
        return;
      case 'shoot':
        this.playShoot(event.form ?? state.form, baseOffset);
        return;
      case 'morph':
        this.playMorph(event.form ?? state.form, baseOffset);
        return;
      case 'dash':
        this.playDash(baseOffset);
        return;
      case 'shield_activate':
        this.playShieldActivate(baseOffset);
        return;
      case 'shield_block':
        this.playShieldBlock(baseOffset);
        return;
      case 'hazard_hit':
        this.playHazardHit(baseOffset);
        return;
      case 'hazard_destroyed':
        this.playHazardDestroyed(baseOffset);
        return;
      case 'bot_hit':
        this.playBotHit(baseOffset);
        return;
      case 'bot_eaten':
        this.playBotEaten(baseOffset);
        return;
      case 'eaten_by_bot':
        this.playEatenByBot(baseOffset);
        return;
      case 'boss_spawn':
        this.playBossSpawn(baseOffset);
        return;
      case 'boss_defeated':
        this.playBossDefeated(baseOffset);
        return;
      case 'booster_activate':
        this.playBoosterActivate(baseOffset);
        return;
      case 'quest_spawn':
        this.playQuestSpawn(baseOffset);
        return;
      case 'quest_progress':
        this.playQuestProgress(state, baseOffset);
        return;
      case 'quest_complete':
        this.playQuestComplete(baseOffset);
        return;
      case 'quest_wrong':
        this.playQuestWrong(baseOffset);
        return;
      case 'heart_lost':
        this.playHeartLost(baseOffset);
        return;
      case 'heart_gained':
        this.playHeartGained(baseOffset);
        return;
      case 'level_up':
        this.playLevelUp(baseOffset);
        return;
      case 'gameover':
        this.playGameOver(state.won, baseOffset);
        return;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }

  /** Release cached buffers and close owned context if created standalone. */
  dispose(): void {
    this.disposed = true;
    this.noiseBuffer = null;
    this.lastPlayedAt.clear();
    this.lastFanfareAt = -1;
    this.lastAlertAt = -1;
    if (this.ownsContext && this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => {});
    }
    this.context = null;
    this.destination = null;
  }

  private ensureContext(): AudioContext | null {
    if (this.disposed || !this.enabled) return null;
    if (this.context && this.context.state !== 'closed') {
      return this.context;
    }
    const Ctor = getSafeAudioContextConstructor();
    if (!Ctor) return null;
    try {
      const ctx = new Ctor();
      this.context = ctx;
      this.destination = ctx.destination;
      this.ownsContext = true;
      return ctx;
    } catch {
      return null;
    }
  }

  /** Stagger simultaneous identical or overlapping fanfare events by a few ms so voices stay clear. */
  private computeCascadeOffset(kind: GameEventKind, now: number): number {
    let offset = 0;
    const prev = this.lastPlayedAt.get(kind);
    if (prev !== undefined && now - prev < 0.04) {
      offset = Math.min(0.11, prev + 0.045 - now);
    }

    if (kind === 'quest_complete' || kind === 'bot_eaten' || kind === 'booster_activate') {
      this.lastFanfareAt = Math.max(this.lastFanfareAt, now + offset);
    } else if (kind === 'boss_defeated') {
      if (now - this.lastFanfareAt < 0.25) {
        offset = Math.max(offset, this.lastFanfareAt + 0.24 - now);
      }
      // Reserve space for the 5-note victory phrase before follow-up level_up chime
      this.lastFanfareAt = Math.max(this.lastFanfareAt, now + offset + 0.22);
    } else if (
      (kind === 'level_up' || kind === 'heart_gained') &&
      now - this.lastFanfareAt < 0.25
    ) {
      offset = Math.max(offset, this.lastFanfareAt + 0.26 - now);
      if (kind === 'heart_gained') {
        this.lastFanfareAt = Math.max(this.lastFanfareAt, now + offset);
      }
    }

    if (kind === 'eaten_by_bot') {
      this.lastAlertAt = Math.max(this.lastAlertAt, now + offset);
    } else if ((kind === 'heart_lost' || kind === 'gameover') && now - this.lastAlertAt < 0.18) {
      offset = Math.max(offset, this.lastAlertAt + 0.18 - now);
    }

    this.lastPlayedAt.set(kind, now + offset);
    return Math.max(0, offset);
  }

  private playEatFood(combo: number, offset = 0): void {
    const idx = Math.min(COMBO_PENTATONIC_SEMITONES.length - 1, Math.max(0, combo - 1));
    const semitones = COMBO_PENTATONIC_SEMITONES[idx] ?? 0;
    const freq = 523.25 * 2 ** (semitones / 12);

    this.scheduleTones(offset, [
      {
        startHz: freq,
        duration: 0.22,
        attack: 0.004,
        gain: 0.22,
        type: 'sine',
        overtoneRatio: 3,
        overtoneGain: 0.14,
      },
      ...(combo >= 3
        ? [
            {
              delay: 0.04,
              startHz: freq * 2,
              duration: 0.15,
              attack: 0.004,
              gain: 0.07,
              type: 'sine' as OscillatorType,
            },
          ]
        : []),
    ]);
  }

  private playEatBonus(offset = 0): void {
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 587.33,
        duration: 0.26,
        attack: 0.005,
        gain: 0.17,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.14,
      },
      {
        delay: 0.055,
        startHz: 783.99,
        duration: 0.28,
        attack: 0.005,
        gain: 0.18,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.14,
      },
      {
        delay: 0.11,
        startHz: 1174.66,
        duration: 0.36,
        attack: 0.005,
        gain: 0.19,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
    ]);
  }

  private playShoot(form: SnakeForm, offset = 0): void {
    switch (form) {
      case 'dragon':
        // Tia sao lấp lánh: twinkling comet chirp
        this.scheduleTones(offset, [
          {
            startHz: 680,
            endHz: 1320,
            duration: 0.1,
            attack: 0.004,
            gain: 0.16,
            type: 'sine',
            overtoneRatio: 2,
            overtoneGain: 0.12,
          },
          {
            delay: 0.03,
            startHz: 1760,
            endHz: 1975,
            duration: 0.09,
            attack: 0.004,
            gain: 0.08,
            type: 'triangle',
            filterHz: 3200,
          },
        ]);
        return;

      case 'phoenix':
        // Tinh thể băng thanh mát: crisp icy crystal chimes + airy shimmer
        this.scheduleTones(offset, [
          {
            startHz: 1318.51,
            endHz: 1567.98,
            duration: 0.11,
            attack: 0.003,
            gain: 0.12,
            type: 'sine',
            overtoneRatio: 2.75,
            overtoneGain: 0.08,
          },
          {
            delay: 0.025,
            startHz: 1975.53,
            endHz: 2349.32,
            duration: 0.11,
            attack: 0.003,
            gain: 0.07,
            type: 'sine',
          },
        ]);
        this.scheduleNoiseBurst(offset, 0.075, 2400, 3800, 0.045, 'highpass');
        return;

      case 'unicorn':
        // Tia sét điện tử dịu vui: playful starlight zap
        this.scheduleTones(offset, [
          {
            startHz: 987.77,
            endHz: 523.25,
            duration: 0.075,
            attack: 0.003,
            gain: 0.14,
            type: 'triangle',
            filterHz: 2600,
          },
          {
            delay: 0.035,
            startHz: 659.25,
            endHz: 1318.51,
            duration: 0.085,
            attack: 0.003,
            gain: 0.1,
            type: 'sine',
          },
        ]);
        return;

      case 'spirit':
        // Tiếng "pốp" hạt hoa nảy: cute bubbly pop + wooden bounce
        this.scheduleTones(offset, [
          {
            startHz: 300,
            endHz: 780,
            duration: 0.065,
            attack: 0.003,
            gain: 0.21,
            type: 'sine',
          },
          {
            delay: 0.045,
            startHz: 659.25,
            endHz: 587.33,
            duration: 0.085,
            attack: 0.003,
            gain: 0.11,
            type: 'sine',
          },
        ]);
        return;
    }
  }

  private playMorph(form: SnakeForm, offset = 0): void {
    const notes = MORPH_CHORDS[form];
    const tones: ToneSpec[] = notes.map((hz, i) => ({
      delay: i * 0.038,
      startHz: hz,
      duration: 0.34,
      attack: 0.006,
      gain: 0.14,
      type: 'triangle',
      filterHz: 2400,
      overtoneRatio: 2,
      overtoneGain: 0.1,
    }));
    this.scheduleTones(offset, tones);
  }

  private playDash(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.22, 420, 1450, 0.13, 'bandpass');
    this.scheduleTones(offset, [
      {
        startHz: 392,
        endHz: 659.25,
        duration: 0.17,
        attack: 0.015,
        gain: 0.065,
        type: 'sine',
      },
    ]);
  }

  private playShieldActivate(offset = 0): void {
    this.scheduleTones(offset, [
      {
        startHz: 392,
        endHz: 783.99,
        duration: 0.16,
        attack: 0.008,
        gain: 0.15,
        type: 'sine',
      },
      {
        delay: 0.04,
        startHz: 523.25,
        duration: 0.44,
        attack: 0.015,
        gain: 0.11,
        type: 'sine',
      },
      {
        delay: 0.07,
        startHz: 783.99,
        duration: 0.42,
        attack: 0.015,
        gain: 0.1,
        type: 'sine',
      },
      {
        delay: 0.1,
        startHz: 1174.66,
        duration: 0.38,
        attack: 0.015,
        gain: 0.07,
        type: 'sine',
      },
    ]);
  }

  private playShieldBlock(offset = 0): void {
    this.scheduleTones(offset, [
      {
        startHz: 440,
        endHz: 880,
        duration: 0.08,
        attack: 0.004,
        gain: 0.19,
        type: 'sine',
      },
      {
        delay: 0.06,
        startHz: 783.99,
        endHz: 587.33,
        duration: 0.085,
        attack: 0.004,
        gain: 0.15,
        type: 'sine',
      },
      {
        delay: 0.105,
        startHz: 1174.66,
        duration: 0.14,
        attack: 0.004,
        gain: 0.09,
        type: 'sine',
      },
    ]);
  }

  private playHazardHit(offset = 0): void {
    this.scheduleTones(offset, [
      {
        startHz: 739.99,
        endHz: 587.33,
        duration: 0.085,
        attack: 0.003,
        gain: 0.15,
        type: 'triangle',
        filterHz: 2200,
      },
      {
        startHz: 1174.66,
        duration: 0.09,
        attack: 0.003,
        gain: 0.09,
        type: 'sine',
      },
    ]);
  }

  private playHazardDestroyed(offset = 0): void {
    this.scheduleTones(offset, [
      { startHz: 1318.51, duration: 0.13, attack: 0.003, gain: 0.1, type: 'sine' },
      { delay: 0.028, startHz: 1661.22, duration: 0.13, attack: 0.003, gain: 0.1, type: 'sine' },
      { delay: 0.056, startHz: 2093.0, duration: 0.14, attack: 0.003, gain: 0.09, type: 'sine' },
      {
        delay: 0.05,
        startHz: 783.99,
        duration: 0.22,
        attack: 0.005,
        gain: 0.15,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
      },
      {
        delay: 0.105,
        startHz: 1046.5,
        duration: 0.28,
        attack: 0.005,
        gain: 0.16,
        type: 'sine',
      },
    ]);
  }

  private playBotHit(offset = 0): void {
    // Crisp crystal armor clink (filtered triangle + gentle crystalline chime)
    this.scheduleTones(offset, [
      {
        startHz: 880.0,
        endHz: 622.25,
        duration: 0.08,
        attack: 0.003,
        gain: 0.14,
        type: 'triangle',
        filterHz: 2600,
      },
      {
        delay: 0.01,
        startHz: 1318.51,
        duration: 0.13,
        attack: 0.003,
        gain: 0.1,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
      },
      {
        delay: 0.032,
        startHz: 1975.53,
        duration: 0.1,
        attack: 0.003,
        gain: 0.06,
        type: 'sine',
      },
    ]);
  }

  private playBotEaten(offset = 0): void {
    // Playful cartoon gulp/chomp followed by an uplifting power-up chord
    this.scheduleTones(offset, [
      {
        startHz: 260,
        endHz: 540,
        duration: 0.065,
        attack: 0.003,
        gain: 0.19,
        type: 'sine',
      },
      {
        delay: 0.048,
        startHz: 523.25,
        endHz: 392.0,
        duration: 0.065,
        attack: 0.003,
        gain: 0.13,
        type: 'triangle',
        filterHz: 1600,
      },
      {
        delay: 0.095,
        startHz: 523.25,
        duration: 0.17,
        attack: 0.004,
        gain: 0.14,
        type: 'triangle',
        filterHz: 2400,
      },
      {
        delay: 0.135,
        startHz: 659.25,
        duration: 0.19,
        attack: 0.004,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
      },
      {
        delay: 0.175,
        startHz: 783.99,
        duration: 0.21,
        attack: 0.004,
        gain: 0.15,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
      },
      {
        delay: 0.215,
        startHz: 1046.5,
        duration: 0.28,
        attack: 0.005,
        gain: 0.17,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
    ]);
  }

  private playEatenByBot(offset = 0): void {
    // Gentle low warning alert — strictly warm sine & filtered triangle, never sawtooth
    this.scheduleTones(offset, [
      {
        startHz: 220.0,
        endHz: 130.81,
        duration: 0.16,
        attack: 0.008,
        gain: 0.18,
        type: 'sine',
      },
      {
        delay: 0.025,
        startHz: 329.63,
        endHz: 261.63,
        duration: 0.14,
        attack: 0.01,
        gain: 0.12,
        type: 'triangle',
        filterHz: 780,
      },
      {
        delay: 0.14,
        startHz: 261.63,
        endHz: 196.0,
        duration: 0.22,
        attack: 0.01,
        gain: 0.12,
        type: 'sine',
      },
    ]);
  }

  private playBossSpawn(offset = 0): void {
    // Fairytale royal herald fanfare announcing Boss Đại Vương Rồng
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 392.0,
        duration: 0.11,
        attack: 0.008,
        gain: 0.14,
        type: 'triangle',
        filterHz: 1900,
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
      {
        delay: 0.11,
        startHz: 523.25,
        duration: 0.11,
        attack: 0.008,
        gain: 0.15,
        type: 'triangle',
        filterHz: 2100,
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
      {
        delay: 0.22,
        startHz: 659.25,
        duration: 0.12,
        attack: 0.008,
        gain: 0.16,
        type: 'triangle',
        filterHz: 2300,
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
      {
        delay: 0.34,
        startHz: 783.99,
        duration: 0.44,
        attack: 0.01,
        gain: 0.17,
        type: 'triangle',
        filterHz: 2400,
        overtoneRatio: 2,
        overtoneGain: 0.14,
      },
      {
        delay: 0.34,
        startHz: 523.25,
        duration: 0.44,
        attack: 0.012,
        gain: 0.11,
        type: 'sine',
      },
      {
        delay: 0.39,
        startHz: 1046.5,
        duration: 0.35,
        attack: 0.01,
        gain: 0.09,
        type: 'sine',
      },
    ]);
  }

  private playBossDefeated(offset = 0): void {
    // Radiant sparkling 5-note victory fanfare (D5 -> F#5 -> A5 -> D6 -> F#6)
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 587.33,
        duration: 0.16,
        attack: 0.005,
        gain: 0.15,
        type: 'triangle',
        filterHz: 2600,
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
      {
        delay: 0.085,
        startHz: 739.99,
        duration: 0.16,
        attack: 0.005,
        gain: 0.16,
        type: 'triangle',
        filterHz: 2700,
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
      {
        delay: 0.17,
        startHz: 880.0,
        duration: 0.18,
        attack: 0.005,
        gain: 0.16,
        type: 'triangle',
        filterHz: 2800,
        overtoneRatio: 2,
        overtoneGain: 0.13,
      },
      {
        delay: 0.255,
        startHz: 1174.66,
        duration: 0.22,
        attack: 0.005,
        gain: 0.17,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
      {
        delay: 0.36,
        startHz: 1479.98,
        duration: 0.56,
        attack: 0.008,
        gain: 0.17,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.11,
      },
      {
        delay: 0.36,
        startHz: 587.33,
        duration: 0.54,
        attack: 0.012,
        gain: 0.1,
        type: 'sine',
      },
      {
        delay: 0.36,
        startHz: 880.0,
        duration: 0.54,
        attack: 0.012,
        gain: 0.09,
        type: 'sine',
      },
    ]);
  }

  private playBoosterActivate(offset = 0): void {
    // Crisp upward super-energy surge with sparkling chime lock-in
    this.scheduleNoiseBurst(offset, 0.19, 550, 2400, 0.075, 'bandpass');
    this.scheduleTones(offset, [
      {
        startHz: 392.0,
        endHz: 1174.66,
        duration: 0.21,
        attack: 0.008,
        gain: 0.15,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
      },
      {
        delay: 0.145,
        startHz: 1174.66,
        duration: 0.22,
        attack: 0.005,
        gain: 0.13,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.09,
      },
      {
        delay: 0.185,
        startHz: 1567.98,
        duration: 0.22,
        attack: 0.005,
        gain: 0.09,
        type: 'sine',
      },
    ]);
  }

  private playQuestSpawn(offset = 0): void {
    this.scheduleTones(offset, [
      {
        startHz: 659.25,
        duration: 0.28,
        attack: 0.006,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.14,
      },
      {
        delay: 0.09,
        startHz: 987.77,
        duration: 0.36,
        attack: 0.006,
        gain: 0.15,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
    ]);
  }

  private playQuestProgress(state: GameState, offset = 0): void {
    // Sequence orbs increment nextSequenceIndex: collecting 1 -> next=2, collecting 2 -> next=3
    const completedStep = Math.max(1, Math.min(3, (state.quest?.nextSequenceIndex ?? 2) - 1));
    const stepPairs: readonly [number, number][] = [
      [523.25, 659.25], // 1: C5 -> E5
      [659.25, 783.99], // 2: E5 -> G5
      [783.99, 1046.5], // 3: G5 -> C6
    ];
    const pair = stepPairs[completedStep - 1] ?? [523.25, 659.25];
    this.scheduleTones(offset, [
      {
        startHz: pair[0],
        duration: 0.2,
        attack: 0.004,
        gain: 0.17,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
      {
        delay: 0.07,
        startHz: pair[1],
        duration: 0.28,
        attack: 0.004,
        gain: 0.19,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
    ]);
  }

  private playQuestComplete(offset = 0): void {
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 523.25,
        duration: 0.18,
        attack: 0.005,
        gain: 0.16,
        type: 'triangle',
        filterHz: 2800,
      },
      {
        delay: 0.075,
        startHz: 659.25,
        duration: 0.18,
        attack: 0.005,
        gain: 0.17,
        type: 'triangle',
        filterHz: 2800,
      },
      {
        delay: 0.15,
        startHz: 783.99,
        duration: 0.2,
        attack: 0.005,
        gain: 0.18,
        type: 'triangle',
        filterHz: 3000,
      },
      {
        delay: 0.225,
        startHz: 1046.5,
        duration: 0.48,
        attack: 0.006,
        gain: 0.19,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
      },
      { delay: 0.24, startHz: 1318.51, duration: 0.46, attack: 0.008, gain: 0.12, type: 'sine' },
    ]);
  }

  private playQuestWrong(offset = 0): void {
    // Soft, cheerful cartoon bubble "boing" — strictly sine waves, never harsh or scary
    this.scheduleTones(offset, [
      {
        startHz: 415.3,
        endHz: 329.63,
        duration: 0.095,
        attack: 0.006,
        gain: 0.17,
        type: 'sine',
      },
      {
        delay: 0.08,
        startHz: 329.63,
        endHz: 392.0,
        duration: 0.16,
        attack: 0.006,
        gain: 0.15,
        type: 'sine',
      },
    ]);
  }

  private playHeartLost(offset = 0): void {
    // Gentle sympathetic two-note dip
    this.scheduleTones(offset, [
      {
        startHz: 659.25,
        endHz: 523.25,
        duration: 0.14,
        attack: 0.01,
        gain: 0.15,
        type: 'sine',
      },
      {
        delay: 0.11,
        startHz: 523.25,
        endHz: 440.0,
        duration: 0.24,
        attack: 0.012,
        gain: 0.14,
        type: 'triangle',
        filterHz: 1100,
      },
    ]);
  }

  private playHeartGained(offset = 0): void {
    const notes = [349.23, 440.0, 523.25, 698.46, 880.0];
    this.scheduleTones(
      offset,
      notes.map((hz, i) => ({
        delay: i * 0.055,
        startHz: hz,
        duration: 0.36,
        attack: 0.008,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.08,
      })),
    );
  }

  private playLevelUp(offset = 0): void {
    this.scheduleTones(offset, [
      { delay: 0, startHz: 523.25, duration: 0.16, attack: 0.005, gain: 0.15, type: 'sine' },
      { delay: 0.05, startHz: 587.33, duration: 0.16, attack: 0.005, gain: 0.15, type: 'sine' },
      { delay: 0.1, startHz: 659.25, duration: 0.18, attack: 0.005, gain: 0.16, type: 'sine' },
      { delay: 0.15, startHz: 783.99, duration: 0.22, attack: 0.005, gain: 0.17, type: 'sine' },
      {
        delay: 0.21,
        startHz: 1046.5,
        duration: 0.52,
        attack: 0.008,
        gain: 0.18,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
      },
      { delay: 0.23, startHz: 1318.51, duration: 0.48, attack: 0.01, gain: 0.12, type: 'sine' },
      { delay: 0.25, startHz: 1567.98, duration: 0.46, attack: 0.01, gain: 0.09, type: 'sine' },
    ]);
  }

  private playGameOver(won: boolean, offset = 0): void {
    if (won) {
      const victory = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98];
      this.scheduleTones(
        offset,
        victory.map((hz, i) => ({
          delay: i * 0.08,
          startHz: hz,
          duration: i === victory.length - 1 ? 0.7 : 0.3,
          attack: 0.006,
          gain: 0.15,
          type: 'sine',
          overtoneRatio: 2,
          overtoneGain: 0.1,
        })),
      );
      return;
    }

    // Gentle encouraging music-box cadence inviting a new game
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 783.99,
        duration: 0.32,
        attack: 0.008,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.08,
      },
      {
        delay: 0.14,
        startHz: 659.25,
        duration: 0.32,
        attack: 0.008,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.08,
      },
      {
        delay: 0.28,
        startHz: 587.33,
        duration: 0.34,
        attack: 0.008,
        gain: 0.13,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.08,
      },
      { delay: 0.42, startHz: 523.25, duration: 0.62, attack: 0.01, gain: 0.15, type: 'sine' },
      {
        delay: 0.42,
        startHz: 392.0,
        duration: 0.62,
        attack: 0.015,
        gain: 0.1,
        type: 'triangle',
        filterHz: 1200,
      },
    ]);
  }

  private scheduleTones(baseOffset: number, specs: readonly ToneSpec[]): void {
    const ctx = this.context;
    const dest = this.destination;
    if (!ctx || !dest || ctx.state === 'closed') return;

    const now = ctx.currentTime + baseOffset;
    for (const spec of specs) {
      this.playSingleTone(ctx, dest, now + (spec.delay ?? 0), spec);
    }
  }

  private playSingleTone(
    ctx: AudioContext,
    dest: AudioNode,
    startTime: number,
    spec: ToneSpec,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const cleanupNodes: AudioNode[] = [osc, gain];

    const attack = Math.max(0.003, spec.attack ?? 0.005);
    const endTime = Math.max(startTime + attack + 0.015, startTime + spec.duration);
    const startHz = Math.max(20, spec.startHz);
    const endHz = spec.endHz !== undefined ? Math.max(20, spec.endHz) : startHz;

    osc.type = spec.type ?? 'sine';
    osc.frequency.setValueAtTime(startHz, startTime);
    if (endHz !== startHz) {
      if (
        spec.pitchMode === 'linear' &&
        typeof osc.frequency.linearRampToValueAtTime === 'function'
      ) {
        osc.frequency.linearRampToValueAtTime(endHz, endTime);
      } else if (typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
        osc.frequency.exponentialRampToValueAtTime(endHz, endTime);
      }
    }

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0005, spec.gain), startTime + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    let tail: AudioNode = osc;
    if (spec.filterHz !== undefined && typeof ctx.createBiquadFilter === 'function') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(spec.filterHz, startTime);
      tail.connect(filter);
      tail = filter;
      cleanupNodes.push(filter);
    }

    tail.connect(gain);
    gain.connect(dest);

    osc.onended = () => {
      for (const node of cleanupNodes) {
        try {
          node.disconnect();
        } catch {
          // Already disconnected
        }
      }
    };
    osc.start(startTime);
    osc.stop(endTime + 0.02);

    if (spec.overtoneRatio && spec.overtoneGain) {
      const overOsc = ctx.createOscillator();
      const overGain = ctx.createGain();
      const overEnd = startTime + Math.max(attack + 0.01, spec.duration * 0.7);
      overOsc.type = 'sine';
      overOsc.frequency.setValueAtTime(Math.max(20, startHz * spec.overtoneRatio), startTime);
      overGain.gain.setValueAtTime(0.0001, startTime);
      overGain.gain.exponentialRampToValueAtTime(
        Math.max(0.0005, spec.gain * spec.overtoneGain),
        startTime + attack,
      );
      overGain.gain.exponentialRampToValueAtTime(0.0001, overEnd);
      overOsc.connect(overGain);
      overGain.connect(dest);
      overOsc.onended = () => {
        try {
          overOsc.disconnect();
          overGain.disconnect();
        } catch {
          // Already disconnected
        }
      };
      overOsc.start(startTime);
      overOsc.stop(overEnd + 0.02);
    }
  }

  private scheduleNoiseBurst(
    baseOffset: number,
    duration: number,
    startFilterHz: number,
    endFilterHz: number,
    peakGain: number,
    filterType: BiquadFilterType,
  ): void {
    const ctx = this.context;
    const dest = this.destination;
    if (
      !ctx ||
      !dest ||
      ctx.state === 'closed' ||
      typeof ctx.createBuffer !== 'function' ||
      typeof ctx.createBufferSource !== 'function' ||
      typeof ctx.createBiquadFilter !== 'function'
    ) {
      return;
    }

    const buffer = this.ensureNoiseBuffer(ctx);
    if (!buffer) return;

    const startTime = ctx.currentTime + baseOffset;
    const endTime = startTime + Math.max(0.04, duration);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(1.1, startTime);
    filter.frequency.setValueAtTime(Math.max(40, startFilterHz), startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFilterHz), endTime);

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0005, peakGain), startTime + 0.03);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(dest);
    src.onended = () => {
      try {
        src.disconnect();
        filter.disconnect();
        gain.disconnect();
      } catch {
        // Already disconnected
      }
    };
    src.start(startTime);
    src.stop(endTime + 0.02);
  }

  private ensureNoiseBuffer(ctx: AudioContext): AudioBuffer | null {
    if (this.noiseBuffer) return this.noiseBuffer;
    try {
      const length = Math.max(1, Math.floor(ctx.sampleRate * 0.5));
      const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
      const data = buffer.getChannelData(0);
      for (let i = 0; i < data.length; i++) {
        data[i] = Math.random() * 2 - 1;
      }
      this.noiseBuffer = buffer;
      return buffer;
    } catch {
      return null;
    }
  }
}
