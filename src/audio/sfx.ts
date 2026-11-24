import type { BotMagicKind, GameEvent, GameEventKind, GameState, SnakeForm } from '../core/types';

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

/** Disconnect every node, ignoring nodes that are already disconnected. */
export function disconnectAll(nodes: readonly (AudioNode | null)[]): void {
  for (const node of nodes) {
    if (!node) continue;
    try {
      node.disconnect();
    } catch {
      // Already disconnected
    }
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
  readonly endFilterHz?: number;
  readonly pitchMode?: 'exp' | 'linear';
  readonly pan?: number;
  readonly shimmer?: number;
  readonly detuneCents?: number;
}

const COMBO_PENTATONIC_SEMITONES: readonly number[] = [0, 2, 4, 7, 9, 12, 14, 16, 19, 21];

// 14-note C major pentatonic scale (C5 -> G7) for ascending progressive bot chomp streaks
const CHOMP_PENTATONIC_SEMITONES: readonly number[] = [
  0, 2, 4, 7, 9, 12, 14, 16, 19, 21, 24, 26, 28, 31,
];

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
  private fxBusInput: GainNode | null = null;
  private fxBusContext: AudioContext | null = null;
  private fxBusDest: AudioNode | null = null;
  private readonly fxBusNodes: AudioNode[] = [];
  private readonly lastPlayedAt = new Map<GameEventKind, number>();
  private lastFanfareAt = -1;
  private lastAlertAt = -1;
  private lastWingWhooshTick = -999;
  private lastPursuitRoarTick = -999;
  private lastDeflectTick = -999;
  private lastRoamingMonsterStepTick = -999;
  private prevBlockedByShelter = false;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /** Attach a shared `AudioContext` and target gain bus owned by `SoundEngine`. */
  attachOutput(context: AudioContext, destination: AudioNode): void {
    if (this.disposed) return;
    if (this.context !== context || this.destination !== destination) {
      this.teardownFxBus();
    }
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
      case 'bot_chomp':
        this.playBotChomp(Math.max(1, event.chompStreak ?? state.chompStreak), baseOffset);
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
      case 'flower_bloom':
      case 'flower_charm':
        this.playFlowerBloom(baseOffset);
        return;
      case 'cocoon_start':
        this.playCocoonStart(baseOffset);
        return;
      case 'butterfly_emerge':
        this.playButterflyEmerge(baseOffset);
        return;
      case 'sky_thunder':
        this.playSkyThunder(baseOffset);
        return;
      case 'butterfly_land':
        this.playButterflyLand(baseOffset);
        return;
      case 'butterfly_frost':
        this.playButterflyFrost(baseOffset);
        return;
      case 'aoe_fire':
        this.playAoeFire(baseOffset);
        return;
      case 'aoe_water':
        this.playAoeWater(baseOffset);
        return;
      case 'aoe_arcane':
        this.playAoeArcane(baseOffset);
        return;
      case 'monster_warning':
        this.playMonsterWarning(baseOffset);
        this.playMonsterRoar(baseOffset + 0.16);
        return;
      case 'monster_strike':
        this.playMonsterStrike(baseOffset);
        return;
      case 'shelter_enter': {
        const currentShelter = state.shelters?.find((s) => s.id === state.currentShelterId);
        if (currentShelter?.kind === 'mermaid') {
          this.playMermaidPalaceEnter(baseOffset);
        } else {
          this.playShelterEnter(baseOffset);
        }
        return;
      }
      case 'shelter_exit':
        return;
      case 'shelter_discovered':
        this.playShelterDiscovered(baseOffset);
        return;
      case 'fairy_visit_start':
        this.playFairyVisitStart(baseOffset);
        return;
      case 'fairy_blessing':
        this.playFairyBlessing(baseOffset);
        return;
      case 'fairy_visit_end':
        this.playFairyVisitEnd(baseOffset);
        return;
      case 'princess_transform':
        this.playPrincessTransform(baseOffset);
        return;
      case 'princess_reveal':
        this.playPrincessReveal(baseOffset);
        return;
      case 'princess_return':
        this.playPrincessReturn(baseOffset);
        return;
      case 'princess_tour_start':
        this.playShelterEnter(baseOffset);
        return;
      case 'princess_tour_lap':
        this.playPrincessTourLap(baseOffset);
        return;
      case 'bot_shoot':
        this.playBotShoot(event.spell ?? 'bolt', baseOffset);
        return;
      case 'bot_spell_cast':
        this.playBotSpellCast(event.spell ?? 'arcane_homing', baseOffset);
        return;
      case 'player_hit_by_magic':
        this.playPlayerHitByMagic(event.spell ?? 'bolt', baseOffset);
        return;
      default: {
        const exhaustive: never = kind;
        return exhaustive;
      }
    }
  }

  /** Sweet rising bell-marimba blossom arpeggio (C5-E5-G5-B5-C6) + harmonic fairy dust. */
  private playFlowerBloom(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.14, 1600, 4400, 0.042, 'highpass', 0.015, 1.3, 0.32, -0.15);
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 146.83,
        endHz: 98.0,
        duration: 0.12,
        attack: 0.008,
        gain: 0.11,
        type: 'sine',
        shimmer: 0,
      },
      {
        delay: 0,
        startHz: 523.25,
        duration: 0.24,
        attack: 0.005,
        gain: 0.17,
        type: 'sine',
        overtoneRatio: 4,
        overtoneGain: 0.1,
        pan: -0.25,
        shimmer: 0.36,
      },
      {
        delay: 0.055,
        startHz: 659.25,
        duration: 0.22,
        attack: 0.005,
        gain: 0.16,
        type: 'sine',
        overtoneRatio: 3,
        overtoneGain: 0.09,
        pan: -0.08,
        shimmer: 0.38,
      },
      {
        delay: 0.11,
        startHz: 783.99,
        duration: 0.24,
        attack: 0.005,
        gain: 0.15,
        type: 'sine',
        overtoneRatio: 2.5,
        overtoneGain: 0.08,
        pan: 0.1,
        shimmer: 0.4,
      },
      {
        delay: 0.165,
        startHz: 987.77,
        duration: 0.26,
        attack: 0.005,
        gain: 0.12,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.08,
        pan: 0.24,
        shimmer: 0.42,
      },
      {
        delay: 0.21,
        startHz: 1046.5,
        duration: 0.34,
        attack: 0.005,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.09,
        pan: 0,
        shimmer: 0.44,
      },
      {
        delay: 0.24,
        startHz: 1567.98,
        duration: 0.24,
        attack: 0.004,
        gain: 0.065,
        type: 'sine',
        pan: -0.32,
        shimmer: 0.45,
      },
      {
        delay: 0.27,
        startHz: 2093.0,
        duration: 0.26,
        attack: 0.004,
        gain: 0.055,
        type: 'sine',
        pan: 0.32,
        shimmer: 0.45,
      },
    ]);
  }

  /** Shimmering rising celesta cocoon swirl + silky harmonic shimmer. */
  private playCocoonStart(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.22, 1400, 4800, 0.048, 'bandpass', 0.025, 1.8, 0.36, 0);
    this.scheduleNoiseBurst(
      offset + 0.04,
      0.16,
      2200,
      4600,
      0.032,
      'highpass',
      0.02,
      1.1,
      0.38,
      0.2,
    );
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 146.83,
        endHz: 196.0,
        duration: 0.26,
        attack: 0.015,
        gain: 0.13,
        type: 'sine',
        shimmer: 0.06,
      },
      {
        delay: 0,
        startHz: 587.33,
        endHz: 880,
        duration: 0.36,
        attack: 0.01,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 3,
        overtoneGain: 0.11,
        pan: -0.28,
        shimmer: 0.38,
      },
      {
        delay: 0.075,
        startHz: 783.99,
        endHz: 1174.66,
        duration: 0.34,
        attack: 0.01,
        gain: 0.12,
        type: 'sine',
        overtoneRatio: 2.5,
        overtoneGain: 0.1,
        pan: 0.26,
        shimmer: 0.4,
      },
      {
        delay: 0.15,
        startHz: 1046.5,
        endHz: 1567.98,
        duration: 0.32,
        attack: 0.01,
        gain: 0.105,
        type: 'triangle',
        filterHz: 3200,
        pan: -0.14,
        shimmer: 0.42,
      },
      {
        delay: 0.2,
        startHz: 1760.0,
        endHz: 2349.32,
        duration: 0.28,
        attack: 0.008,
        gain: 0.065,
        type: 'sine',
        pan: 0.3,
        shimmer: 0.45,
      },
    ]);
  }

  /** Magical sweeping pink-ice harp & celesta glissando + wing-flutter + crystal star chimes. */
  private playButterflyEmerge(offset = 0): void {
    this.scheduleNoiseBurst(
      offset + 0.01,
      0.22,
      2000,
      5400,
      0.044,
      'bandpass',
      0.018,
      1.6,
      0.42,
      -0.22,
    );
    this.scheduleNoiseBurst(
      offset + 0.09,
      0.19,
      2800,
      5800,
      0.036,
      'highpass',
      0.015,
      1.2,
      0.46,
      0.22,
    );

    const notes = [523.25, 659.25, 783.99, 987.77, 1174.66, 1567.98, 1975.53];
    const tones: ToneSpec[] = [
      {
        delay: 0,
        startHz: 130.81,
        endHz: 65.41,
        duration: 0.24,
        attack: 0.012,
        gain: 0.145,
        type: 'sine',
        shimmer: 0,
      },
      {
        delay: 0.03,
        startHz: 261.63,
        duration: 0.48,
        attack: 0.016,
        gain: 0.088,
        type: 'triangle',
        filterHz: 1500,
        pan: -0.18,
        shimmer: 0.28,
      },
      {
        delay: 0.045,
        startHz: 392.0,
        duration: 0.48,
        attack: 0.018,
        gain: 0.068,
        type: 'triangle',
        filterHz: 1650,
        pan: 0.18,
        shimmer: 0.32,
      },
      ...notes.map((hz, i) => ({
        delay: i * 0.04,
        startHz: hz,
        duration: 0.42,
        attack: 0.005,
        gain: i >= 5 ? 0.115 : 0.138,
        type: (i >= 5 ? 'sine' : 'triangle') as OscillatorType,
        filterHz: i >= 5 ? undefined : 3000,
        overtoneRatio: i >= 5 ? 2.75 : 2,
        overtoneGain: i >= 5 ? 0.085 : 0.11,
        pan: (i / (notes.length - 1)) * 0.76 - 0.38,
        shimmer: 0.46,
      })),
      // Shimmering crystal frost crown bells on top
      {
        delay: notes.length * 0.04 - 0.02,
        startHz: 2093.0,
        endHz: 2637.02,
        duration: 0.3,
        attack: 0.004,
        gain: 0.072,
        type: 'sine',
        overtoneRatio: 2.75,
        overtoneGain: 0.07,
        detuneCents: 4,
        pan: -0.26,
        shimmer: 0.52,
      },
      {
        delay: notes.length * 0.04 + 0.025,
        startHz: 2349.32,
        endHz: 3135.96,
        duration: 0.32,
        attack: 0.004,
        gain: 0.06,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.065,
        detuneCents: -4,
        pan: 0.28,
        shimmer: 0.54,
      },
    ];
    this.scheduleTones(offset, tones);
  }

  /** Dreamy falling ice crystal celesta/glockenspiel chimes + soft frosty stereo breeze. */
  private playButterflyFrost(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.17, 2600, 5200, 0.026, 'highpass', 0.016, 1.4, 0.42, -0.18);
    this.scheduleNoiseBurst(
      offset + 0.03,
      0.14,
      4200,
      2200,
      0.02,
      'bandpass',
      0.012,
      2.2,
      0.46,
      0.18,
    );

    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 2093.0,
        duration: 0.18,
        attack: 0.004,
        gain: 0.068,
        type: 'sine',
        overtoneRatio: 2.75,
        overtoneGain: 0.08,
        detuneCents: 4,
        pan: -0.3,
        shimmer: 0.48,
      },
      {
        delay: 0.035,
        startHz: 1567.98,
        duration: 0.2,
        attack: 0.004,
        gain: 0.064,
        type: 'sine',
        overtoneRatio: 2.75,
        overtoneGain: 0.075,
        detuneCents: -4,
        pan: 0.24,
        shimmer: 0.5,
      },
      {
        delay: 0.05,
        startHz: 2637.02,
        endHz: 1975.53,
        duration: 0.14,
        attack: 0.004,
        gain: 0.032,
        type: 'sine',
        pan: 0.32,
        shimmer: 0.54,
      },
      {
        delay: 0.07,
        startHz: 1318.51,
        duration: 0.22,
        attack: 0.004,
        gain: 0.058,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.08,
        pan: -0.16,
        shimmer: 0.52,
      },
      {
        delay: 0.105,
        startHz: 987.77,
        duration: 0.25,
        attack: 0.005,
        gain: 0.052,
        type: 'triangle',
        filterHz: 3200,
        endFilterHz: 1500,
        pan: 0.26,
        shimmer: 0.52,
      },
    ]);
  }

  /** Crisp electric crystal crackle + heroic sub-bass thunder boom + fifth bell sparkle. */
  private playSkyThunder(offset = 0): void {
    // Crisp lightning snap + stereo electric sizzle + rolling warm lowpass thunder noise
    this.scheduleNoiseBurst(offset, 0.09, 2400, 5200, 0.055, 'highpass', 0.003, 1.4, 0.34, -0.25);
    this.scheduleNoiseBurst(
      offset + 0.015,
      0.14,
      900,
      3400,
      0.075,
      'bandpass',
      0.005,
      1.5,
      0.35,
      0.22,
    );
    this.scheduleNoiseBurst(offset + 0.05, 0.36, 520, 140, 0.088, 'lowpass', 0.015, 1.0, 0.18, 0);

    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 1567.98,
        endHz: 880,
        duration: 0.095,
        attack: 0.003,
        gain: 0.16,
        type: 'sawtooth',
        filterHz: 2500,
        endFilterHz: 1100,
        pan: -0.28,
        shimmer: 0.36,
      },
      {
        delay: 0.025,
        startHz: 2093.0,
        endHz: 1174.66,
        duration: 0.085,
        attack: 0.003,
        gain: 0.11,
        type: 'triangle',
        filterHz: 3200,
        pan: 0.28,
        shimmer: 0.38,
      },
      {
        delay: 0.04,
        startHz: 1046.5,
        endHz: 659.25,
        duration: 0.1,
        attack: 0.003,
        gain: 0.13,
        type: 'triangle',
        filterHz: 2400,
        shimmer: 0.32,
      },
      // Heroic deep-yet-warm sub-bass thunder punch
      {
        delay: 0.035,
        startHz: 120,
        endHz: 52,
        duration: 0.42,
        attack: 0.012,
        gain: 0.2,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.08,
        shimmer: 0.04,
      },
      // Playful magical fifth/octave sky-sparkle chime on top
      {
        delay: 0.07,
        startHz: 783.99,
        duration: 0.24,
        attack: 0.005,
        gain: 0.085,
        type: 'sine',
        pan: -0.2,
        shimmer: 0.42,
      },
      {
        delay: 0.1,
        startHz: 1174.66,
        duration: 0.26,
        attack: 0.005,
        gain: 0.07,
        type: 'sine',
        pan: 0.2,
        shimmer: 0.45,
      },
    ]);
  }

  /** Soft bouncy landing thump + gentle descending harp chime + petal-puff breeze. */
  private playButterflyLand(offset = 0): void {
    this.scheduleNoiseBurst(offset + 0.03, 0.17, 1900, 780, 0.048, 'bandpass', 0.01, 1.3, 0.34, 0);
    const harp = [1046.5, 880, 783.99, 659.25, 523.25];
    this.scheduleTones(offset, [
      {
        delay: 0.02,
        startHz: 135,
        endHz: 62,
        duration: 0.12,
        attack: 0.006,
        gain: 0.14,
        type: 'sine',
        shimmer: 0,
      },
      ...harp.map((hz, i) => ({
        delay: i * 0.048,
        startHz: hz,
        duration: i === harp.length - 1 ? 0.28 : 0.16,
        attack: 0.005,
        gain: 0.12,
        type: 'sine' as const,
        overtoneRatio: i === harp.length - 1 ? 1.5 : 2,
        overtoneGain: 0.12,
        pan: 0.3 - i * 0.15,
        shimmer: 0.38,
      })),
    ]);
  }

  /** Exciting dragon fire nova: deep sub shockwave + blazing noise sweep + warm brass & ember sparkles. */
  private playAoeFire(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.36, 280, 2800, 0.105, 'bandpass', 0.022, 1.4, 0.28, -0.15);
    this.scheduleNoiseBurst(
      offset + 0.1,
      0.28,
      2000,
      560,
      0.068,
      'lowpass',
      0.015,
      1.0,
      0.22,
      0.15,
    );
    this.scheduleNoiseBurst(
      offset + 0.04,
      0.14,
      2600,
      4800,
      0.045,
      'highpass',
      0.005,
      1.2,
      0.35,
      0,
    );
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 135,
        endHz: 48,
        duration: 0.38,
        attack: 0.012,
        gain: 0.21,
        type: 'sine',
        shimmer: 0,
      },
      {
        delay: 0.01,
        startHz: 220,
        duration: 0.3,
        attack: 0.016,
        gain: 0.105,
        type: 'sawtooth',
        filterHz: 1350,
        endFilterHz: 620,
        pan: -0.18,
        shimmer: 0.2,
      },
      {
        delay: 0.02,
        startHz: 329.63,
        duration: 0.3,
        attack: 0.018,
        gain: 0.09,
        type: 'sawtooth',
        filterHz: 1550,
        endFilterHz: 750,
        pan: 0.18,
        shimmer: 0.24,
      },
      {
        delay: 0.035,
        startHz: 440,
        duration: 0.28,
        attack: 0.016,
        gain: 0.085,
        type: 'triangle',
        filterHz: 2000,
        shimmer: 0.28,
      },
      {
        delay: 0.05,
        startHz: 880,
        duration: 0.24,
        attack: 0.005,
        gain: 0.07,
        type: 'sine',
        pan: -0.28,
        shimmer: 0.4,
      },
      {
        delay: 0.085,
        startHz: 1318.51,
        duration: 0.24,
        attack: 0.005,
        gain: 0.055,
        type: 'sine',
        pan: 0.28,
        shimmer: 0.42,
      },
    ]);
  }

  /** Bubbly tidal wave splash + deep aqua sub-swell + sparkling fifth/octave cascade. */
  private playAoeWater(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.34, 480, 3400, 0.095, 'bandpass', 0.02, 2.0, 0.32, -0.18);
    this.scheduleNoiseBurst(
      offset + 0.12,
      0.28,
      2500,
      650,
      0.068,
      'lowpass',
      0.018,
      1.2,
      0.28,
      0.18,
    );
    const aqua = [523.25, 659.25, 783.99, 987.77, 1318.51, 1567.98];
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 145,
        endHz: 58,
        duration: 0.32,
        attack: 0.012,
        gain: 0.18,
        type: 'sine',
        shimmer: 0,
      },
      {
        delay: 0,
        startHz: 320,
        endHz: 840,
        duration: 0.12,
        attack: 0.005,
        gain: 0.12,
        type: 'sine',
        shimmer: 0.3,
      },
      ...aqua.map((hz, i) => ({
        delay: 0.028 + i * 0.04,
        startHz: hz,
        duration: 0.2,
        attack: 0.005,
        gain: i >= 4 ? 0.075 : 0.105,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.1,
        pan: (i % 2 === 0 ? -1 : 1) * 0.28,
        shimmer: 0.42,
      })),
    ]);
  }

  /** Mystical cosmic crystal chord + sub-pulse + twinkling starlight octave/fifth cascade. */
  private playAoeArcane(offset = 0): void {
    this.scheduleNoiseBurst(
      offset + 0.02,
      0.24,
      2200,
      5400,
      0.045,
      'highpass',
      0.015,
      1.4,
      0.44,
      0,
    );
    const chord = [293.66, 440, 587.33, 739.99];
    const sparkle = [1046.5, 1318.51, 1567.98, 1975.53, 2349.32];
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 146.83,
        endHz: 73.42,
        duration: 0.36,
        attack: 0.014,
        gain: 0.18,
        type: 'sine',
        shimmer: 0.04,
      },
      ...chord.map((hz, i) => ({
        delay: 0,
        startHz: hz,
        duration: 0.42,
        attack: 0.016,
        gain: 0.082,
        type: 'triangle' as const,
        filterHz: 2500,
        endFilterHz: 1100,
        pan: i % 2 === 0 ? -0.18 : 0.18,
        shimmer: 0.34,
      })),
      ...sparkle.map((hz, i) => ({
        delay: 0.032 + i * 0.044,
        startHz: hz,
        duration: 0.2,
        attack: 0.004,
        gain: 0.088,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.13,
        pan: (i / (sparkle.length - 1)) * 0.7 - 0.35,
        shimmer: 0.48,
      })),
    ]);
  }

  /** Urgent fantasy warning horn + herald alarm chimes for Monster Calamity. */
  playMonsterWarning(offset = 0): void {
    // Brassy alarm horn with resonant harmonics (D4 -> F#4 -> A4)
    this.scheduleNoiseBurst(offset, 0.28, 400, 2400, 0.08, 'bandpass', 0.02, 1.6, 0.3, -0.2);
    this.scheduleNoiseBurst(offset + 0.18, 0.24, 600, 2800, 0.07, 'bandpass', 0.02, 1.5, 0.35, 0.2);

    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 293.66, // D4
        endHz: 310.0,
        duration: 0.18,
        attack: 0.012,
        gain: 0.16,
        type: 'sawtooth',
        filterHz: 1800,
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: -0.2,
      },
      {
        delay: 0.16,
        startHz: 369.99, // F#4
        endHz: 390.0,
        duration: 0.18,
        attack: 0.012,
        gain: 0.17,
        type: 'sawtooth',
        filterHz: 2000,
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: 0,
      },
      {
        delay: 0.32,
        startHz: 440.0, // A4
        endHz: 466.16,
        duration: 0.25,
        attack: 0.015,
        gain: 0.18,
        type: 'sawtooth',
        filterHz: 2200,
        overtoneRatio: 2,
        overtoneGain: 0.14,
        pan: 0.2,
        shimmer: 0.3,
      },
    ]);
  }

  /** Deep rumbling distant sky monster roar / colossal behemoth cry. */
  playMonsterRoar(offset = 0): void {
    // Rolling sub-rumble + sweeping filtered roar noise
    this.scheduleNoiseBurst(offset, 0.65, 180, 750, 0.12, 'lowpass', 0.06, 1.8, 0.25, -0.1);
    this.scheduleNoiseBurst(offset + 0.12, 0.55, 320, 140, 0.1, 'bandpass', 0.05, 1.6, 0.2, 0.15);

    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 82.41, // E2 low monster growl
        endHz: 55.0, // down to A1
        duration: 0.58,
        attack: 0.05,
        gain: 0.19,
        type: 'sawtooth',
        filterHz: 420,
        endFilterHz: 180,
        pan: -0.15,
      },
      {
        delay: 0.05,
        startHz: 123.47, // B2
        endHz: 73.42,
        duration: 0.52,
        attack: 0.06,
        gain: 0.14,
        type: 'triangle',
        filterHz: 500,
        endFilterHz: 200,
        pan: 0.15,
      },
    ]);
  }

  /** Sweet cozy shelter bell chime upon entering the mushroom/crystal sanctuary. */
  playShelterEnter(offset = 0): void {
    // Sparkling fairy dust shimmer
    this.scheduleNoiseBurst(offset, 0.22, 2200, 5600, 0.045, 'highpass', 0.01, 1.2, 0.45, 0);

    // Warm pentatonic glockenspiel / bell chime: G5, B5, D6, G6
    const bellNotes = [783.99, 987.77, 1174.66, 1567.98];
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 196.0,
        endHz: 98.0,
        duration: 0.18,
        attack: 0.008,
        gain: 0.12,
        type: 'sine',
        shimmer: 0,
      },
      ...bellNotes.map((hz, i) => ({
        delay: i * 0.055,
        startHz: hz,
        duration: i === bellNotes.length - 1 ? 0.45 : 0.28,
        attack: 0.003,
        gain: 0.13,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.15,
        pan: (i % 2 === 0 ? -1 : 1) * 0.18,
        shimmer: 0.38,
      })),
    ]);
  }

  /**
   * Sparkling magical discovery harp arpeggio when discovering a new palace / castle.
   */
  playShelterDiscovered(offset = 0): void {
    // 1) Sparkling fairy dust shimmer
    this.scheduleNoiseBurst(offset, 0.35, 3000, 8000, 0.05, 'highpass', 0.008, 1.3, 0.45, 0);

    // 2) Fast crystalline ascending harp arpeggio: C5 -> E5 -> G5 -> B5 -> C6 -> E6 -> G6 -> C7
    const harpNotes = [523.25, 659.25, 783.99, 987.77, 1046.5, 1318.51, 1567.98, 2093.0];
    this.scheduleTones(offset, [
      // Warm resonant bass foundation
      {
        delay: 0,
        startHz: 130.81,
        endHz: 130.81,
        duration: 0.42,
        attack: 0.015,
        gain: 0.14,
        type: 'sine',
        shimmer: 0,
      },
      // Ascending crystalline arpeggio
      ...harpNotes.map((hz, i) => ({
        delay: i * 0.045,
        startHz: hz,
        duration: i >= harpNotes.length - 2 ? 0.65 : 0.35,
        attack: 0.003,
        gain: 0.12,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.22,
        pan: (i % 2 === 0 ? -1 : 1) * 0.22,
        shimmer: 0.45,
      })),
      // Harmonic resonance bell chime at peak
      {
        delay: harpNotes.length * 0.045,
        startHz: 1567.98,
        duration: 0.6,
        attack: 0.005,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 1.5,
        overtoneGain: 0.15,
        shimmer: 0.5,
      },
      {
        delay: harpNotes.length * 0.045,
        startHz: 2093.0,
        duration: 0.7,
        attack: 0.004,
        gain: 0.11,
        type: 'sine',
        pan: -0.15,
      },
    ]);
  }

  /** Dreamy ascending fairy harp & celesta arpeggio when a Guardian Fairy visits. */
  playFairyVisitStart(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.28, 2800, 6800, 0.042, 'highpass', 0.012, 1.3, 0.45, 0);
    const notes = [523.25, 659.25, 783.99, 987.77, 1174.66, 1567.98];
    this.scheduleTones(offset, [
      ...notes.map((hz, i) => ({
        delay: i * 0.048,
        startHz: hz,
        duration: i >= notes.length - 1 ? 0.52 : 0.3,
        attack: 0.004,
        gain: 0.115,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.16,
        pan: (i / (notes.length - 1)) * 0.56 - 0.28,
        shimmer: 0.46,
      })),
    ]);
  }

  /** Sweet twinkling 3-note magic wand blessing chime. */
  playFairyBlessing(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.14, 3200, 6200, 0.028, 'highpass', 0.008, 1.2, 0.4, 0);
    const chime = [987.77, 1318.51, 1567.98];
    this.scheduleTones(offset, [
      ...chime.map((hz, i) => ({
        delay: i * 0.045,
        startHz: hz,
        duration: 0.24,
        attack: 0.004,
        gain: 0.095,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: (i - 1) * 0.22,
        shimmer: 0.44,
      })),
    ]);
  }

  /** Rising shimmering magical glissando + warm swelling chord while the snake transforms. */
  playPrincessTransform(offset = 0): void {
    this.scheduleNoiseBurst(offset, 1.2, 1200, 7600, 0.05, 'bandpass', 0.35, 1.6, 0.5, -0.2);
    this.scheduleNoiseBurst(offset + 0.2, 1.0, 2400, 8200, 0.036, 'highpass', 0.3, 1.2, 0.5, 0.2);
    const gliss = [
      392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5, 1174.66, 1318.51, 1567.98,
      1760.0,
    ];
    this.scheduleTones(offset, [
      // Warm swelling pad chord (C major add9)
      ...[261.63, 329.63, 392.0, 587.33].map((hz, i) => ({
        delay: 0,
        startHz: hz,
        duration: 1.5,
        attack: 0.55,
        gain: 0.06,
        type: 'triangle' as const,
        filterHz: 1800,
        pan: (i - 1.5) * 0.18,
        shimmer: 0.4,
      })),
      // Ascending sparkle glissando
      ...gliss.map((hz, i) => ({
        delay: 0.05 + i * 0.11,
        startHz: hz,
        duration: 0.32,
        attack: 0.004,
        gain: 0.085,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.14,
        pan: Math.sin(i * 0.9) * 0.4,
        shimmer: 0.5,
      })),
    ]);
  }

  /** Glorious sparkling bell fanfare when the Fairy Princess is revealed. */
  playPrincessReveal(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.5, 3000, 9000, 0.06, 'highpass', 0.01, 1.3, 0.5, 0);
    const chord = [523.25, 659.25, 783.99, 1046.5];
    const bells = [1318.51, 1567.98, 2093.0, 2637.02, 3135.96];
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 130.81,
        endHz: 130.81,
        duration: 0.9,
        attack: 0.02,
        gain: 0.13,
        type: 'sine',
        shimmer: 0.1,
      },
      ...chord.map((hz, i) => ({
        delay: 0,
        startHz: hz,
        duration: 1.1,
        attack: 0.01,
        gain: 0.09,
        type: 'triangle' as const,
        filterHz: 3000,
        endFilterHz: 1600,
        pan: (i - 1.5) * 0.2,
        shimmer: 0.48,
      })),
      ...bells.map((hz, i) => ({
        delay: 0.12 + i * 0.07,
        startHz: hz,
        duration: 0.6,
        attack: 0.003,
        gain: 0.075,
        type: 'sine' as const,
        overtoneRatio: 2.75,
        overtoneGain: 0.12,
        pan: (i % 2 === 0 ? -1 : 1) * 0.3,
        shimmer: 0.55,
      })),
    ]);
  }

  /** Gentle descending harp & sparkle while the princess turns back into the snake. */
  playPrincessReturn(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.6, 6000, 1800, 0.035, 'bandpass', 0.05, 1.4, 0.45, 0);
    const notes = [1567.98, 1318.51, 1174.66, 987.77, 783.99, 659.25, 523.25];
    this.scheduleTones(offset, [
      ...notes.map((hz, i) => ({
        delay: i * 0.07,
        startHz: hz,
        duration: i === notes.length - 1 ? 0.5 : 0.26,
        attack: 0.005,
        gain: 0.085,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.1,
        pan: 0.3 - i * 0.1,
        shimmer: 0.44,
      })),
    ]);
  }

  /** Cheerful twinkle when the princess completes a sightseeing lap around a castle. */
  playPrincessTourLap(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.22, 3200, 7000, 0.04, 'highpass', 0.01, 1.2, 0.45, 0);
    const notes = [783.99, 987.77, 1174.66, 1567.98];
    this.scheduleTones(offset, [
      ...notes.map((hz, i) => ({
        delay: i * 0.06,
        startHz: hz,
        duration: i === notes.length - 1 ? 0.45 : 0.22,
        attack: 0.004,
        gain: 0.1,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.14,
        pan: (i - 1.5) * 0.2,
        shimmer: 0.46,
      })),
    ]);
  }

  /** Soft descending lullaby harp glissando when a Guardian Fairy waves goodbye. */
  playFairyVisitEnd(offset = 0): void {
    const notes = [1318.51, 1174.66, 987.77, 783.99];
    this.scheduleTones(offset, [
      ...notes.map((hz, i) => ({
        delay: i * 0.06,
        startHz: hz,
        duration: i === notes.length - 1 ? 0.42 : 0.24,
        attack: 0.006,
        gain: 0.09,
        type: 'sine' as const,
        overtoneRatio: 2,
        overtoneGain: 0.1,
        pan: 0.24 - i * 0.16,
        shimmer: 0.42,
      })),
    ]);
  }

  /** Bubbly ocean chime when entering the Mermaid Palace. */
  playMermaidPalaceEnter(offset = 0): void {
    // 1) Rising bubbly water droplet chirps
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 420.0,
        endHz: 780.0,
        duration: 0.09,
        attack: 0.005,
        gain: 0.12,
        type: 'sine',
        pan: -0.18,
      },
      {
        delay: 0.045,
        startHz: 520.0,
        endHz: 960.0,
        duration: 0.08,
        attack: 0.004,
        gain: 0.13,
        type: 'sine',
        pan: 0.18,
      },
      {
        delay: 0.095,
        startHz: 650.0,
        endHz: 1200.0,
        duration: 0.07,
        attack: 0.003,
        gain: 0.14,
        type: 'sine',
        pan: -0.08,
      },
    ]);

    // 2) Gentle ocean wave splash shimmer
    this.scheduleNoiseBurst(offset + 0.02, 0.28, 900, 2800, 0.048, 'bandpass', 0.012, 1.4, 0.35, 0);

    // 3) Ethereal ocean crystal bell chime (Aquamarine sea chord): F5, A5, C6, E6, A6
    const oceanNotes = [698.46, 880.0, 1046.5, 1318.51, 1760.0];
    this.scheduleTones(offset + 0.08, [
      {
        delay: 0,
        startHz: 174.61,
        endHz: 174.61,
        duration: 0.35,
        attack: 0.02,
        gain: 0.12,
        type: 'sine',
      },
      ...oceanNotes.map((hz, i) => ({
        delay: i * 0.055,
        startHz: hz,
        duration: i === oceanNotes.length - 1 ? 0.55 : 0.32,
        attack: 0.004,
        gain: 0.12,
        type: 'sine' as const,
        overtoneRatio: 3,
        overtoneGain: 0.12,
        pan: (i % 2 === 0 ? -1 : 1) * 0.2,
        shimmer: 0.55,
      })),
    ]);
  }

  /** Slow gentle step / rumble when near a wandering roaming monster. */
  playRoamingMonsterStep(distance: number, offset = 0): void {
    const normDist = Math.max(0, Math.min(24, distance));
    const intensity = 1 - normDist / 24;
    const stepGain = Math.max(0.02, Math.min(0.12, intensity * 0.12));

    // Soft low ground rumble step
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 75.0,
        endHz: 42.0,
        duration: 0.24,
        attack: 0.014,
        gain: stepGain,
        type: 'triangle',
        filterHz: 200,
        endFilterHz: 80,
      },
    ]);

    // Earthy soft rustle
    this.scheduleNoiseBurst(offset, 0.16, 260, 90, stepGain * 0.45, 'lowpass', 0.018, 1.2, 0.15, 0);
  }

  /** Thunderous monster lightning strike boom with crackle and earth-shaking rumble. */
  playMonsterStrike(offset = 0): void {
    // Sharp high crackle + dense mid bandpass punch + rolling low bass boom
    this.scheduleNoiseBurst(offset, 0.12, 2800, 6000, 0.08, 'highpass', 0.002, 1.5, 0.4, -0.2);
    this.scheduleNoiseBurst(
      offset + 0.02,
      0.25,
      800,
      2200,
      0.12,
      'bandpass',
      0.006,
      1.8,
      0.35,
      0.2,
    );
    this.scheduleNoiseBurst(offset + 0.06, 0.55, 450, 90, 0.15, 'lowpass', 0.018, 1.2, 0.2, 0);

    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 2200.0,
        endHz: 440.0,
        duration: 0.1,
        attack: 0.002,
        gain: 0.18,
        type: 'sawtooth',
        filterHz: 3000,
        endFilterHz: 1200,
      },
      {
        delay: 0.02,
        startHz: 140.0,
        endHz: 38.0, // Sub-bass heavy impact
        duration: 0.48,
        attack: 0.005,
        gain: 0.24,
        type: 'sine',
        filterHz: 350,
        endFilterHz: 80,
      },
      {
        delay: 0.05,
        startHz: 98.0,
        endHz: 45.0,
        duration: 0.38,
        attack: 0.01,
        gain: 0.18,
        type: 'triangle',
        filterHz: 250,
      },
    ]);
  }

  /** Menacing low wing-whoosh of the monster flying right behind the player. */
  playMonsterWingWhoosh(distance?: number, offset = 0): void {
    const proximity =
      distance != null && Number.isFinite(distance)
        ? Math.max(0.35, Math.min(1.0, 1.0 - distance / 28))
        : 0.8;

    // Atmospheric rushing wind with downward pitch sweep
    this.scheduleNoiseBurst(
      offset,
      0.48,
      480 * proximity,
      110,
      0.15 * proximity,
      'lowpass',
      0.12,
      1.3,
      0.2,
      -0.1,
    );

    // Deep aerodynamic wing stroke pulse (88Hz -> 44Hz)
    this.scheduleTones(offset, [
      {
        delay: 0.04,
        startHz: 88.0,
        endHz: 44.0,
        duration: 0.42,
        attack: 0.08,
        gain: 0.18 * proximity,
        type: 'sine',
        filterHz: 220,
        endFilterHz: 80,
        pan: -0.05,
      },
    ]);
  }

  /** Menacing pursuit snarl / roar as the monster actively chases the player within 25 units. */
  playMonsterPursuitRoar(distance?: number, offset = 0): void {
    const proximity =
      distance != null && Number.isFinite(distance)
        ? Math.max(0.4, Math.min(1.0, 1.0 - distance / 28))
        : 0.85;

    // Aggressive snarling bandpass noise sweep
    this.scheduleNoiseBurst(
      offset,
      0.55,
      420,
      160,
      0.13 * proximity,
      'bandpass',
      0.04,
      2.0,
      0.25,
      0.1,
    );

    // Guttural dual sawtooth roar with pitch bend (104Hz -> 55Hz)
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 104.0,
        endHz: 55.0,
        duration: 0.52,
        attack: 0.03,
        gain: 0.2 * proximity,
        type: 'sawtooth',
        filterHz: 460,
        endFilterHz: 180,
        pan: -0.1,
      },
      {
        delay: 0.04,
        startHz: 146.83,
        endHz: 73.42,
        duration: 0.46,
        attack: 0.04,
        gain: 0.14 * proximity,
        type: 'sawtooth',
        filterHz: 520,
        endFilterHz: 220,
        pan: 0.12,
      },
    ]);
  }

  /** Impact/deflection sound when monster hits the shelter forcefield dome. */
  playMonsterShieldDeflect(offset = 0): void {
    // 1) Heavy concussive impact thud: sub-bass pulse
    this.scheduleNoiseBurst(offset, 0.18, 120, 480, 0.16, 'lowpass', 0.005, 1.4, 0.15, 0);

    // 2) Electric spark deflection sizzle ripples
    this.scheduleNoiseBurst(
      offset + 0.02,
      0.28,
      2200,
      5600,
      0.11,
      'highpass',
      0.008,
      1.8,
      0.45,
      0.15,
    );

    // 3) Resonant crystalline forcefield barrier tones (C6, G6, C7 shimmer)
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 180.0,
        endHz: 42.0, // Sub-impact boom
        duration: 0.32,
        attack: 0.003,
        gain: 0.22,
        type: 'sine',
        filterHz: 280,
      },
      {
        delay: 0.015,
        startHz: 1046.5, // C6 forcefield glass chime
        endHz: 1108.73,
        duration: 0.38,
        attack: 0.004,
        gain: 0.16,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.14,
        pan: -0.18,
        shimmer: 0.42,
      },
      {
        delay: 0.045,
        startHz: 1567.98, // G6 harmonic deflection ring
        duration: 0.45,
        attack: 0.004,
        gain: 0.14,
        type: 'triangle',
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: 0.18,
        shimmer: 0.48,
      },
      {
        delay: 0.08,
        startHz: 2093.0, // C7 high crystal ripple
        duration: 0.5,
        attack: 0.005,
        gain: 0.1,
        type: 'sine',
        pan: 0,
        shimmer: 0.55,
      },
    ]);
  }

  /**
   * Update periodic audio effects driven by GameState:
   * - Menacing wing-whoosh & pursuit roar when monster is within 25 units.
   * - Impact/deflection sound when monster hits the shelter forcefield dome.
   * - Gentle step/rumble when near roaming monsters within 22 units.
   */
  updateState(state: GameState): void {
    if (this.disposed || !this.enabled) return;
    if (state.phase !== 'playing') {
      this.prevBlockedByShelter = false;
      return;
    }

    const currentTick = state.elapsedTicks;

    // 0) Gentle step / rumble for nearby roaming monsters within 22 units
    const roaming = state.roamingMonsters;
    if (roaming && roaming.length > 0 && state.snake[0] && !state.inShelter) {
      const head = state.snake[0];
      let nearestDist = 999;
      for (const rm of roaming) {
        const d = Math.hypot(rm.x - head.x, rm.z - head.z);
        if (d < nearestDist) {
          nearestDist = d;
        }
      }
      if (nearestDist <= 22) {
        if (currentTick - this.lastRoamingMonsterStepTick >= 28) {
          this.lastRoamingMonsterStepTick = currentTick;
          this.playRoamingMonsterStep(nearestDist);
        }
      }
    }

    const monster = state.monsterEvent;
    if (!monster || monster.phase === 'idle') {
      this.prevBlockedByShelter = false;
      return;
    }

    // 1) Forcefield Dome Deflection Sound
    const isBlocked = Boolean(monster.isBlockedByShelter);
    if (isBlocked) {
      if (!this.prevBlockedByShelter || currentTick - this.lastDeflectTick >= 40) {
        this.lastDeflectTick = currentTick;
        this.playMonsterShieldDeflect();
      }
    }
    this.prevBlockedByShelter = isBlocked;

    // 2) Active Chase Wing-Whoosh & Pursuit Roar within 25 units
    let dist = monster.distanceToPlayer;
    if ((dist == null || !Number.isFinite(dist)) && monster.monsterPos && state.snake[0]) {
      dist = Math.hypot(
        monster.monsterPos.x - state.snake[0].x,
        monster.monsterPos.z - state.snake[0].z,
      );
    }

    if (dist != null && Number.isFinite(dist) && dist <= 25 && !state.inShelter && !isBlocked) {
      // Periodic wing-whoosh every 24 ticks (~1.2s at 20Hz)
      if (currentTick - this.lastWingWhooshTick >= 24) {
        this.lastWingWhooshTick = currentTick;
        this.playMonsterWingWhoosh(dist);
      }

      // Periodic pursuit roar every 65 ticks (~3.25s at 20Hz)
      if (currentTick - this.lastPursuitRoarTick >= 65) {
        this.lastPursuitRoarTick = currentTick;
        this.playMonsterPursuitRoar(dist);
      }
    }
  }

  /** Release cached buffers and close owned context if created standalone. */
  dispose(): void {
    this.disposed = true;
    this.noiseBuffer = null;
    this.teardownFxBus();
    this.lastPlayedAt.clear();
    this.lastFanfareAt = -1;
    this.lastAlertAt = -1;
    this.lastWingWhooshTick = -999;
    this.lastPursuitRoarTick = -999;
    this.lastDeflectTick = -999;
    this.lastRoamingMonsterStepTick = -999;
    this.prevBlockedByShelter = false;
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

    if (kind === 'bot_chomp') {
      // Keep rapid 50ms chomps ultra-crisp (<= 15ms micro-stagger) and never delay bot_eaten or level_up.
      if (prev !== undefined && now - prev < 0.015) {
        offset = Math.min(0.015, Math.max(0, prev + 0.012 - now));
      }
      this.lastPlayedAt.set(kind, now + offset);
      return Math.max(0, offset);
    }

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

    const tones: ToneSpec[] = [
      {
        startHz: 142 + idx * 6,
        endHz: 70,
        duration: 0.055,
        attack: 0.003,
        gain: 0.11,
        type: 'sine',
        shimmer: 0,
      },
      {
        startHz: freq,
        duration: 0.24,
        attack: 0.004,
        gain: 0.2,
        type: 'sine',
        overtoneRatio: 3,
        overtoneGain: 0.14,
        shimmer: 0.26,
      },
    ];

    if (combo >= 2) {
      tones.push({
        delay: 0.024,
        startHz: freq * 1.5,
        duration: 0.16,
        attack: 0.004,
        gain: 0.055,
        type: 'sine',
        pan: -0.2,
        shimmer: 0.34,
      });
    }

    if (combo >= 3) {
      tones.push({
        delay: 0.042,
        startHz: freq * 2,
        duration: 0.17,
        attack: 0.004,
        gain: 0.072,
        type: 'sine',
        pan: 0.22,
        shimmer: 0.38,
      });
      this.scheduleNoiseBurst(
        offset + 0.01,
        0.05,
        2800,
        5000,
        0.025,
        'highpass',
        0.004,
        1.2,
        0.32,
        0.18,
      );
    }

    this.scheduleTones(offset, tones);
  }

  private playEatBonus(offset = 0): void {
    this.scheduleNoiseBurst(
      offset + 0.02,
      0.12,
      2400,
      5000,
      0.036,
      'highpass',
      0.006,
      1.2,
      0.36,
      0,
    );
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 145,
        endHz: 68,
        duration: 0.09,
        attack: 0.004,
        gain: 0.13,
        type: 'sine',
        shimmer: 0,
      },
      {
        delay: 0,
        startHz: 587.33,
        duration: 0.26,
        attack: 0.005,
        gain: 0.165,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.14,
        pan: -0.22,
        shimmer: 0.34,
      },
      {
        delay: 0.052,
        startHz: 783.99,
        duration: 0.28,
        attack: 0.005,
        gain: 0.175,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.14,
        pan: 0.06,
        shimmer: 0.36,
      },
      {
        delay: 0.105,
        startHz: 1174.66,
        duration: 0.36,
        attack: 0.005,
        gain: 0.18,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: 0.24,
        shimmer: 0.4,
      },
      {
        delay: 0.14,
        startHz: 1567.98,
        duration: 0.28,
        attack: 0.005,
        gain: 0.075,
        type: 'sine',
        pan: -0.18,
        shimmer: 0.44,
      },
    ]);
  }

  private playShoot(form: SnakeForm, offset = 0): void {
    switch (form) {
      case 'dragon':
        // Phun Lửa Rồng: sub-bass fire punch + roaring filtered flame noise + crackle sparks
        this.scheduleNoiseBurst(
          offset,
          0.22,
          220,
          1650,
          0.105,
          'bandpass',
          0.016,
          1.4,
          0.28,
          -0.14,
        );
        this.scheduleNoiseBurst(
          offset + 0.04,
          0.16,
          1850,
          520,
          0.058,
          'lowpass',
          0.014,
          1.0,
          0.22,
          0.14,
        );
        this.scheduleNoiseBurst(
          offset + 0.045,
          0.065,
          2400,
          4600,
          0.048,
          'highpass',
          0.004,
          1.3,
          0.32,
          0.22,
        );
        this.scheduleTones(offset, [
          {
            startHz: 155,
            endHz: 68,
            duration: 0.14,
            attack: 0.004,
            gain: 0.16,
            type: 'sine',
            shimmer: 0,
          },
          {
            startHz: 165,
            endHz: 92,
            duration: 0.17,
            attack: 0.01,
            gain: 0.088,
            type: 'sawtooth',
            filterHz: 1050,
            endFilterHz: 460,
            shimmer: 0.14,
          },
          {
            delay: 0.022,
            startHz: 1950,
            endHz: 920,
            duration: 0.044,
            attack: 0.003,
            gain: 0.052,
            type: 'triangle',
            filterHz: 3400,
            pan: -0.26,
            shimmer: 0.34,
          },
          {
            delay: 0.068,
            startHz: 2580,
            endHz: 1180,
            duration: 0.044,
            attack: 0.003,
            gain: 0.048,
            type: 'triangle',
            filterHz: 3600,
            pan: 0.28,
            shimmer: 0.36,
          },
          {
            delay: 0.11,
            startHz: 3100,
            endHz: 1480,
            duration: 0.04,
            attack: 0.003,
            gain: 0.036,
            type: 'sine',
            pan: -0.15,
            shimmer: 0.4,
          },
        ]);
        return;

      case 'phoenix':
        // Phun Băng Giá: arctic wind rush + crisp crystal sub-puff + shimmering ice chime triad
        this.scheduleNoiseBurst(
          offset,
          0.21,
          1900,
          5200,
          0.072,
          'highpass',
          0.015,
          1.2,
          0.38,
          -0.2,
        );
        this.scheduleNoiseBurst(
          offset + 0.03,
          0.15,
          3800,
          1650,
          0.048,
          'bandpass',
          0.01,
          2.2,
          0.4,
          0.2,
        );
        this.scheduleTones(offset, [
          {
            delay: 0,
            startHz: 240,
            endHz: 115,
            duration: 0.1,
            attack: 0.004,
            gain: 0.1,
            type: 'sine',
            shimmer: 0.04,
          },
          {
            delay: 0,
            startHz: 1318.51,
            duration: 0.16,
            attack: 0.003,
            gain: 0.09,
            type: 'sine',
            overtoneRatio: 2.75,
            overtoneGain: 0.095,
            pan: -0.28,
            shimmer: 0.42,
          },
          {
            delay: 0.03,
            startHz: 1661.22,
            duration: 0.16,
            attack: 0.003,
            gain: 0.08,
            type: 'sine',
            overtoneRatio: 2.75,
            overtoneGain: 0.085,
            pan: 0.16,
            shimmer: 0.42,
          },
          {
            delay: 0.06,
            startHz: 1975.53,
            duration: 0.18,
            attack: 0.003,
            gain: 0.074,
            type: 'sine',
            overtoneRatio: 2.5,
            overtoneGain: 0.08,
            pan: -0.14,
            shimmer: 0.44,
          },
          {
            delay: 0.088,
            startHz: 2637.02,
            duration: 0.18,
            attack: 0.003,
            gain: 0.048,
            type: 'sine',
            pan: 0.32,
            shimmer: 0.48,
          },
        ]);
        return;

      case 'unicorn':
        // Phun Nước Xoáy: aquatic sub-pulse + pressurized hydro-jet + bubbly water cascade
        this.scheduleNoiseBurst(
          offset,
          0.19,
          420,
          2850,
          0.094,
          'bandpass',
          0.014,
          2.3,
          0.34,
          -0.18,
        );
        this.scheduleNoiseBurst(
          offset + 0.04,
          0.15,
          2100,
          620,
          0.056,
          'bandpass',
          0.01,
          1.5,
          0.34,
          0.18,
        );
        this.scheduleTones(offset, [
          {
            delay: 0,
            startHz: 195,
            endHz: 88,
            duration: 0.11,
            attack: 0.004,
            gain: 0.12,
            type: 'sine',
            shimmer: 0.04,
          },
          {
            delay: 0.004,
            startHz: 320,
            endHz: 860,
            duration: 0.065,
            attack: 0.003,
            gain: 0.125,
            type: 'sine',
            pan: -0.3,
            shimmer: 0.34,
          },
          {
            delay: 0.042,
            startHz: 460,
            endHz: 1140,
            duration: 0.062,
            attack: 0.003,
            gain: 0.105,
            type: 'sine',
            pan: 0.3,
            shimmer: 0.36,
          },
          {
            delay: 0.08,
            startHz: 610,
            endHz: 1460,
            duration: 0.06,
            attack: 0.003,
            gain: 0.086,
            type: 'sine',
            pan: -0.2,
            shimmer: 0.38,
          },
          {
            delay: 0.116,
            startHz: 780,
            endHz: 1820,
            duration: 0.058,
            attack: 0.003,
            gain: 0.065,
            type: 'sine',
            pan: 0.24,
            shimmer: 0.42,
          },
          {
            delay: 0.095,
            startHz: 1174.66,
            duration: 0.15,
            attack: 0.004,
            gain: 0.052,
            type: 'sine',
            shimmer: 0.44,
          },
        ]);
        return;

      case 'spirit':
        // Phun Tơ Phép: buoyant bounce + airy silk whoosh + elastic pluck + fairy twinkle cascade
        this.scheduleNoiseBurst(
          offset,
          0.14,
          1400,
          4800,
          0.062,
          'bandpass',
          0.008,
          1.8,
          0.38,
          -0.22,
        );
        this.scheduleNoiseBurst(
          offset + 0.03,
          0.12,
          3400,
          1300,
          0.04,
          'highpass',
          0.006,
          1.2,
          0.4,
          0.22,
        );
        this.scheduleTones(offset, [
          {
            delay: 0,
            startHz: 220,
            endHz: 110,
            duration: 0.09,
            attack: 0.004,
            gain: 0.095,
            type: 'sine',
            shimmer: 0.04,
          },
          {
            delay: 0,
            startHz: 520,
            endHz: 1620,
            duration: 0.072,
            attack: 0.003,
            gain: 0.09,
            type: 'triangle',
            filterHz: 3200,
            pan: -0.25,
            shimmer: 0.38,
          },
          {
            delay: 0.025,
            startHz: 293.66,
            endHz: 440,
            duration: 0.13,
            attack: 0.003,
            gain: 0.14,
            type: 'triangle',
            filterHz: 2200,
            overtoneRatio: 2,
            overtoneGain: 0.12,
            shimmer: 0.35,
          },
          {
            delay: 0.05,
            startHz: 880,
            duration: 0.11,
            attack: 0.003,
            gain: 0.075,
            type: 'sine',
            pan: 0.22,
            shimmer: 0.44,
          },
          {
            delay: 0.076,
            startHz: 1174.66,
            duration: 0.12,
            attack: 0.003,
            gain: 0.062,
            type: 'sine',
            pan: -0.2,
            shimmer: 0.46,
          },
          {
            delay: 0.102,
            startHz: 1318.51,
            duration: 0.13,
            attack: 0.003,
            gain: 0.05,
            type: 'sine',
            pan: 0.28,
            shimmer: 0.48,
          },
        ]);
        return;
    }
  }

  private playMorph(form: SnakeForm, offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.2, 1200, 4200, 0.052, 'bandpass', 0.015, 1.5, 0.38, 0);
    const notes = MORPH_CHORDS[form];
    const topNote = notes[notes.length - 1] ?? 783.99;
    const tones: ToneSpec[] = [
      {
        delay: 0,
        startHz: 140,
        endHz: 70,
        duration: 0.18,
        attack: 0.008,
        gain: 0.15,
        type: 'sine',
        shimmer: 0.04,
      },
      ...notes.map((hz, i) => ({
        delay: i * 0.036,
        startHz: hz,
        duration: 0.36,
        attack: 0.006,
        gain: 0.135,
        type: 'triangle' as const,
        filterHz: 2500,
        overtoneRatio: 2,
        overtoneGain: 0.1,
        pan: (i / Math.max(1, notes.length - 1)) * 0.64 - 0.32,
        shimmer: 0.4,
      })),
      {
        delay: notes.length * 0.036,
        startHz: topNote * 1.5,
        duration: 0.26,
        attack: 0.005,
        gain: 0.06,
        type: 'sine',
        pan: -0.24,
        shimmer: 0.46,
      },
      {
        delay: notes.length * 0.036 + 0.03,
        startHz: topNote * 2,
        duration: 0.28,
        attack: 0.005,
        gain: 0.052,
        type: 'sine',
        pan: 0.24,
        shimmer: 0.48,
      },
    ];
    this.scheduleTones(offset, tones);
  }

  private playDash(offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.22, 380, 2200, 0.115, 'bandpass', 0.018, 1.4, 0.28, -0.15);
    this.scheduleNoiseBurst(
      offset + 0.02,
      0.15,
      1800,
      4400,
      0.046,
      'highpass',
      0.012,
      1.1,
      0.34,
      0.18,
    );
    this.scheduleTones(offset, [
      {
        startHz: 175,
        endHz: 75,
        duration: 0.11,
        attack: 0.004,
        gain: 0.14,
        type: 'sine',
        shimmer: 0,
      },
      {
        startHz: 392,
        endHz: 659.25,
        duration: 0.17,
        attack: 0.012,
        gain: 0.072,
        type: 'sine',
        pan: -0.18,
        shimmer: 0.32,
      },
      {
        delay: 0.025,
        startHz: 587.33,
        endHz: 987.77,
        duration: 0.16,
        attack: 0.01,
        gain: 0.058,
        type: 'triangle',
        filterHz: 2600,
        pan: 0.18,
        shimmer: 0.36,
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

  /** Enemy bolt: short, low "pew" — clearly darker than the player's bright sprays. */
  private playBotShoot(spell: BotMagicKind, offset = 0): void {
    const base = spell === 'frost_orb' ? 880 : spell === 'fire_spread' ? 330 : 520;
    this.scheduleTones(offset, [
      {
        startHz: base,
        endHz: base * 0.5,
        duration: 0.11,
        attack: 0.003,
        gain: 0.09,
        type: 'square',
        filterHz: 1800,
        endFilterHz: 500,
      },
    ]);
  }

  /** Spell release: rising whoosh + a spell-specific tail (fire crackle / ice chime / arcane wobble). */
  private playBotSpellCast(spell: BotMagicKind, offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.2, 500, 2600, 0.05, 'bandpass', 0.04, 1.2, 0.2, 0.1);
    if (spell === 'frost_orb') {
      this.scheduleTones(offset, [
        {
          startHz: 1568,
          duration: 0.2,
          attack: 0.004,
          gain: 0.07,
          type: 'sine',
          overtoneRatio: 2.5,
          overtoneGain: 0.06,
        },
        { delay: 0.07, startHz: 2093, duration: 0.2, attack: 0.004, gain: 0.05, type: 'sine' },
      ]);
    } else if (spell === 'fire_spread') {
      this.scheduleTones(offset, [
        {
          startHz: 196,
          endHz: 392,
          duration: 0.2,
          attack: 0.01,
          gain: 0.1,
          type: 'sawtooth',
          filterHz: 900,
        },
      ]);
    } else {
      this.scheduleTones(offset, [
        {
          startHz: 392,
          endHz: 784,
          duration: 0.24,
          attack: 0.01,
          gain: 0.08,
          type: 'triangle',
          shimmer: 0.4,
        },
        {
          delay: 0.1,
          startHz: 466,
          endHz: 349,
          duration: 0.2,
          attack: 0.01,
          gain: 0.06,
          type: 'sine',
        },
      ]);
    }
  }

  /** Ouch! Thump + descending zap, distinctive but not frightening. */
  private playPlayerHitByMagic(spell: BotMagicKind, offset = 0): void {
    this.scheduleNoiseBurst(offset, 0.16, 2400, 400, 0.08, 'lowpass', 0.004, 1.0, 0.1, 0);
    this.scheduleTones(offset, [
      { startHz: 150, endHz: 60, duration: 0.2, attack: 0.003, gain: 0.26, type: 'sine' },
      {
        startHz: spell === 'frost_orb' ? 1318 : 880,
        endHz: spell === 'frost_orb' ? 988 : 330,
        duration: 0.16,
        attack: 0.003,
        gain: 0.12,
        type: 'triangle',
        filterHz: 2600,
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

  private playBotChomp(streak: number, offset = 0): void {
    // Cheerful cartoon segment bite: sub-bass punch + juicy pop + filtered crunch + sparkle dust + 14-note rising marimba + fifth/octave sparkles
    const safeStreak = Number.isFinite(streak) ? Math.max(1, Math.floor(streak)) : 1;
    const idx = Math.min(CHOMP_PENTATONIC_SEMITONES.length - 1, safeStreak - 1);
    const semitones = CHOMP_PENTATONIC_SEMITONES[idx] ?? 0;
    const noteHz = 523.25 * 2 ** (semitones / 12);

    const popStartHz = 255 + idx * 14;
    const popEndHz = popStartHz * 2.15;
    const snapStartHz = 440 + idx * 18;
    const snapEndHz = 290 + idx * 12;
    const sparkleGain = 0.036 + Math.min(0.018, idx * 0.0015);
    const stereoFlip = safeStreak % 2 === 0 ? 0.2 : -0.2;

    this.scheduleNoiseBurst(
      offset,
      0.048,
      2200 + idx * 120,
      4400 + idx * 80,
      sparkleGain,
      'bandpass',
      0.004,
      1.3,
      0.28,
      stereoFlip,
    );

    const marimbaGain = idx >= 10 ? 0.125 : idx >= 6 ? 0.14 : 0.155;
    const tones: ToneSpec[] = [
      {
        startHz: 155 + idx * 5,
        endHz: 68,
        duration: 0.058,
        attack: 0.003,
        gain: 0.15,
        type: 'sine',
        shimmer: 0,
      },
      {
        startHz: popStartHz,
        endHz: popEndHz,
        duration: 0.055,
        attack: 0.003,
        gain: 0.15,
        type: 'sine',
        shimmer: 0.16,
      },
      {
        startHz: snapStartHz,
        endHz: snapEndHz,
        duration: 0.052,
        attack: 0.003,
        gain: 0.092,
        type: 'triangle',
        filterHz: 1850,
        shimmer: 0.18,
      },
      {
        delay: 0.01,
        startHz: noteHz,
        duration: 0.145,
        attack: 0.003,
        gain: marimbaGain,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: idx >= 10 ? 0.035 : 0.095,
        pan: stereoFlip * 0.7,
        shimmer: 0.3,
      },
    ];

    if (safeStreak >= 2) {
      tones.push({
        delay: 0.02,
        startHz: noteHz * 1.5,
        duration: 0.115,
        attack: 0.003,
        gain: idx >= 10 ? 0.038 : 0.054,
        type: 'sine',
        filterHz: 4200,
        pan: -stereoFlip,
        shimmer: 0.34,
      });
    }

    if (safeStreak >= 4) {
      tones.push({
        delay: 0.028,
        startHz: noteHz * 2,
        duration: 0.13,
        attack: 0.003,
        gain: idx >= 10 ? 0.044 : 0.064,
        type: 'sine',
        filterHz: 4500,
        pan: stereoFlip,
        shimmer: 0.38,
      });
    }

    this.scheduleTones(offset, tones);
  }

  private playBotEaten(offset = 0): void {
    // Playful cartoon gulp/chomp + sub-bass victory thump + uplifting Cmaj9 power-up chord
    this.scheduleNoiseBurst(offset + 0.03, 0.16, 650, 3000, 0.058, 'bandpass', 0.01, 1.4, 0.34, 0);
    this.scheduleTones(offset, [
      {
        startHz: 145,
        endHz: 58,
        duration: 0.15,
        attack: 0.004,
        gain: 0.2,
        type: 'sine',
        shimmer: 0,
      },
      {
        startHz: 260,
        endHz: 580,
        duration: 0.068,
        attack: 0.003,
        gain: 0.18,
        type: 'sine',
        shimmer: 0.2,
      },
      {
        delay: 0.048,
        startHz: 523.25,
        endHz: 392.0,
        duration: 0.065,
        attack: 0.003,
        gain: 0.125,
        type: 'triangle',
        filterHz: 1650,
        shimmer: 0.24,
      },
      {
        delay: 0.095,
        startHz: 523.25,
        duration: 0.18,
        attack: 0.004,
        gain: 0.135,
        type: 'triangle',
        filterHz: 2400,
        pan: -0.24,
        shimmer: 0.36,
      },
      {
        delay: 0.13,
        startHz: 659.25,
        duration: 0.2,
        attack: 0.004,
        gain: 0.135,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
        pan: -0.08,
        shimmer: 0.38,
      },
      {
        delay: 0.165,
        startHz: 783.99,
        duration: 0.22,
        attack: 0.004,
        gain: 0.14,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
        pan: 0.12,
        shimmer: 0.4,
      },
      {
        delay: 0.2,
        startHz: 1046.5,
        duration: 0.3,
        attack: 0.005,
        gain: 0.16,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: 0.24,
        shimmer: 0.42,
      },
      {
        delay: 0.23,
        startHz: 1567.98,
        duration: 0.26,
        attack: 0.005,
        gain: 0.072,
        type: 'sine',
        pan: -0.2,
        shimmer: 0.45,
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
    this.scheduleNoiseBurst(
      offset + 0.02,
      0.09,
      2400,
      4800,
      0.032,
      'highpass',
      0.005,
      1.2,
      0.36,
      0,
    );
    this.scheduleTones(offset, [
      {
        startHz: 180,
        endHz: 86,
        duration: 0.075,
        attack: 0.004,
        gain: 0.11,
        type: 'sine',
        shimmer: 0,
      },
      {
        startHz: pair[0],
        duration: 0.22,
        attack: 0.004,
        gain: 0.16,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: -0.18,
        shimmer: 0.36,
      },
      {
        delay: 0.068,
        startHz: pair[1],
        duration: 0.3,
        attack: 0.004,
        gain: 0.18,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: 0.18,
        shimmer: 0.4,
      },
      {
        delay: 0.1,
        startHz: pair[1] * 1.5,
        duration: 0.24,
        attack: 0.004,
        gain: 0.065,
        type: 'sine',
        pan: -0.22,
        shimmer: 0.44,
      },
    ]);
  }

  private playQuestComplete(offset = 0): void {
    this.scheduleNoiseBurst(offset + 0.04, 0.18, 2200, 5200, 0.045, 'highpass', 0.008, 1.3, 0.4, 0);
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 130.81,
        endHz: 65.41,
        duration: 0.14,
        attack: 0.005,
        gain: 0.16,
        type: 'sine',
        shimmer: 0,
      },
      {
        delay: 0,
        startHz: 523.25,
        duration: 0.19,
        attack: 0.005,
        gain: 0.155,
        type: 'triangle',
        filterHz: 2800,
        pan: -0.26,
        shimmer: 0.38,
      },
      {
        delay: 0.07,
        startHz: 659.25,
        duration: 0.19,
        attack: 0.005,
        gain: 0.165,
        type: 'triangle',
        filterHz: 2800,
        pan: -0.08,
        shimmer: 0.4,
      },
      {
        delay: 0.14,
        startHz: 783.99,
        duration: 0.21,
        attack: 0.005,
        gain: 0.17,
        type: 'triangle',
        filterHz: 3000,
        pan: 0.12,
        shimmer: 0.42,
      },
      {
        delay: 0.215,
        startHz: 1046.5,
        duration: 0.5,
        attack: 0.006,
        gain: 0.18,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.12,
        pan: 0,
        shimmer: 0.45,
      },
      {
        delay: 0.23,
        startHz: 1318.51,
        duration: 0.46,
        attack: 0.008,
        gain: 0.115,
        type: 'sine',
        pan: -0.24,
        shimmer: 0.46,
      },
      {
        delay: 0.245,
        startHz: 1567.98,
        duration: 0.44,
        attack: 0.008,
        gain: 0.088,
        type: 'sine',
        pan: 0.26,
        shimmer: 0.48,
      },
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
    this.scheduleNoiseBurst(offset + 0.08, 0.22, 2000, 5000, 0.044, 'highpass', 0.01, 1.3, 0.42, 0);
    this.scheduleTones(offset, [
      {
        delay: 0,
        startHz: 523.25,
        duration: 0.16,
        attack: 0.005,
        gain: 0.145,
        type: 'sine',
        pan: -0.25,
        shimmer: 0.34,
      },
      {
        delay: 0.05,
        startHz: 587.33,
        duration: 0.16,
        attack: 0.005,
        gain: 0.145,
        type: 'sine',
        pan: -0.1,
        shimmer: 0.36,
      },
      {
        delay: 0.1,
        startHz: 659.25,
        duration: 0.18,
        attack: 0.005,
        gain: 0.155,
        type: 'sine',
        pan: 0.08,
        shimmer: 0.38,
      },
      {
        delay: 0.15,
        startHz: 783.99,
        duration: 0.22,
        attack: 0.005,
        gain: 0.165,
        type: 'sine',
        pan: 0.22,
        shimmer: 0.4,
      },
      {
        delay: 0.2,
        startHz: 130.81,
        endHz: 65.41,
        duration: 0.18,
        attack: 0.006,
        gain: 0.17,
        type: 'sine',
        shimmer: 0,
      },
      {
        delay: 0.21,
        startHz: 1046.5,
        duration: 0.54,
        attack: 0.008,
        gain: 0.175,
        type: 'sine',
        overtoneRatio: 2,
        overtoneGain: 0.1,
        shimmer: 0.44,
      },
      {
        delay: 0.23,
        startHz: 1318.51,
        duration: 0.48,
        attack: 0.01,
        gain: 0.115,
        type: 'sine',
        pan: -0.25,
        shimmer: 0.45,
      },
      {
        delay: 0.25,
        startHz: 1567.98,
        duration: 0.46,
        attack: 0.01,
        gain: 0.09,
        type: 'sine',
        pan: 0.25,
        shimmer: 0.46,
      },
      {
        delay: 0.275,
        startHz: 2093.0,
        duration: 0.36,
        attack: 0.008,
        gain: 0.055,
        type: 'sine',
        shimmer: 0.48,
      },
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

  private teardownFxBus(): void {
    disconnectAll(this.fxBusNodes);
    this.fxBusNodes.length = 0;
    this.fxBusInput = null;
    this.fxBusContext = null;
    this.fxBusDest = null;
  }

  /**
   * Lazily build a gentle stereo slapback echo + warm lowpass feedback bus.
   * Guarded cleanly so headless/mock `AudioContext` instances never throw.
   */
  private ensureFxBus(ctx: AudioContext, dest: AudioNode): GainNode | null {
    if (this.fxBusInput && this.fxBusContext === ctx && this.fxBusDest === dest) {
      return this.fxBusInput;
    }
    if (this.fxBusContext !== ctx || this.fxBusDest !== dest) {
      this.teardownFxBus();
    }
    if (typeof ctx.createDelay !== 'function' || typeof ctx.createGain !== 'function') {
      return null;
    }

    try {
      const now = ctx.currentTime;
      const input = ctx.createGain();
      const delayL = ctx.createDelay(0.5);
      const delayR = ctx.createDelay(0.5);
      const wetL = ctx.createGain();
      const wetR = ctx.createGain();
      const fbGain = ctx.createGain();

      input.gain.setValueAtTime(1, now);
      delayL.delayTime.setValueAtTime(0.072, now);
      delayR.delayTime.setValueAtTime(0.058, now);
      wetL.gain.setValueAtTime(0.24, now);
      wetR.gain.setValueAtTime(0.2, now);
      fbGain.gain.setValueAtTime(0.24, now);

      this.fxBusNodes.push(input, delayL, delayR, wetL, wetR, fbGain);

      let echoHead: AudioNode = input;
      if (typeof ctx.createBiquadFilter === 'function') {
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.setValueAtTime(3100, now);
        lp.Q.setValueAtTime(0.7, now);
        input.connect(lp);
        echoHead = lp;
        this.fxBusNodes.push(lp);
      }

      echoHead.connect(delayL);
      delayL.connect(wetL);
      delayL.connect(delayR);
      delayR.connect(wetR);
      delayR.connect(fbGain);
      fbGain.connect(echoHead === input ? delayL : echoHead);

      if (typeof ctx.createStereoPanner === 'function') {
        const panL = ctx.createStereoPanner();
        const panR = ctx.createStereoPanner();
        panL.pan.setValueAtTime(-0.52, now);
        panR.pan.setValueAtTime(0.52, now);
        wetL.connect(panL);
        wetR.connect(panR);
        panL.connect(dest);
        panR.connect(dest);
        this.fxBusNodes.push(panL, panR);
      } else {
        wetL.connect(dest);
        wetR.connect(dest);
      }

      this.fxBusInput = input;
      this.fxBusContext = ctx;
      this.fxBusDest = dest;
      return input;
    } catch {
      this.teardownFxBus();
      return null;
    }
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
    if (
      spec.detuneCents !== undefined &&
      'detune' in osc &&
      osc.detune &&
      typeof osc.detune.setValueAtTime === 'function'
    ) {
      osc.detune.setValueAtTime(spec.detuneCents, startTime);
    }
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
      filter.frequency.setValueAtTime(Math.max(40, spec.filterHz), startTime);
      if (
        spec.endFilterHz !== undefined &&
        typeof filter.frequency.exponentialRampToValueAtTime === 'function'
      ) {
        filter.frequency.exponentialRampToValueAtTime(Math.max(40, spec.endFilterHz), endTime);
      }
      tail.connect(filter);
      tail = filter;
      cleanupNodes.push(filter);
    }

    tail.connect(gain);

    let panner: StereoPannerNode | null = null;
    let outNode: AudioNode = gain;
    if (spec.pan !== undefined && spec.pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, spec.pan)), startTime);
      gain.connect(panner);
      outNode = panner;
      cleanupNodes.push(panner);
    }
    outNode.connect(dest);

    let sendGain: GainNode | null = null;
    const shimmerAmt = spec.shimmer ?? (startHz >= 220 ? 0.22 : 0);
    if (shimmerAmt > 0) {
      const fxBus = this.ensureFxBus(ctx, dest);
      if (fxBus) {
        sendGain = ctx.createGain();
        sendGain.gain.setValueAtTime(Math.min(0.65, Math.max(0, shimmerAmt)), startTime);
        outNode.connect(sendGain);
        sendGain.connect(fxBus);
        cleanupNodes.push(sendGain);
      }
    }

    osc.onended = () => disconnectAll(cleanupNodes);
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
      if (panner) {
        overGain.connect(panner);
      } else {
        overGain.connect(dest);
        if (sendGain) {
          overGain.connect(sendGain);
        }
      }
      overOsc.onended = () => disconnectAll([overOsc, overGain]);
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
    attack = 0.03,
    q = 1.1,
    shimmer = 0.22,
    pan = 0,
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
    const safeDur = Math.max(0.04, duration);
    const endTime = startTime + safeDur;
    const safeAttack = Math.min(Math.max(0.003, attack), safeDur * 0.45);

    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;

    const filter = ctx.createBiquadFilter();
    filter.type = filterType;
    filter.Q.setValueAtTime(Math.max(0.1, q), startTime);
    filter.frequency.setValueAtTime(Math.max(40, startFilterHz), startTime);
    if (typeof filter.frequency.exponentialRampToValueAtTime === 'function') {
      filter.frequency.exponentialRampToValueAtTime(Math.max(40, endFilterHz), endTime);
    }

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0005, peakGain), startTime + safeAttack);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    const cleanupNodes: AudioNode[] = [src, filter, gain];
    src.connect(filter);
    filter.connect(gain);

    let outNode: AudioNode = gain;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), startTime);
      gain.connect(panner);
      outNode = panner;
      cleanupNodes.push(panner);
    }
    outNode.connect(dest);

    if (shimmer > 0) {
      const fxBus = this.ensureFxBus(ctx, dest);
      if (fxBus) {
        const sendGain = ctx.createGain();
        sendGain.gain.setValueAtTime(Math.min(0.6, Math.max(0, shimmer)), startTime);
        outNode.connect(sendGain);
        sendGain.connect(fxBus);
        cleanupNodes.push(sendGain);
      }
    }

    src.onended = () => disconnectAll(cleanupNodes);
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
