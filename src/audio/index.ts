import type { GameEvent, GameState } from '../core/types';
import { MagicalMusic } from './music';
import { Sfx, disconnectAll, getSafeAudioContextConstructor, smoothSetGain } from './sfx';

export { Sfx } from './sfx';
export { MagicalMusic } from './music';
export { VoiceHelper } from './voice';

export interface SoundEngineOptions {
  soundEnabled?: boolean;
  musicEnabled?: boolean;
  volume?: number; // 0..1
}

const SFX_BUS_GAIN = 0.9;

function clampVolume(value: number): number {
  if (!Number.isFinite(value)) return 0.8;
  return Math.min(1, Math.max(0, value));
}

/**
 * Unified Web Audio engine for "Vương Quốc Rắn Phép Thuật 3D".
 *
 * Lazily creates and unlocks the macOS/browser `AudioContext` on first user
 * interaction, routes background music and 24 magical sound effects through
 * smoothed `masterGain`, `musicGain`, and `sfxGain` buses, and degrades
 * silently in headless/test environments without Web Audio.
 */
export class SoundEngine {
  private context: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private sfxGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;

  private readonly sfx: Sfx;
  private readonly music: MagicalMusic;

  private soundEnabled: boolean;
  private musicEnabled: boolean;
  private volume: number;
  private unlocked = false;
  private disposed = false;
  private lastState: GameState | null = null;

  constructor(options?: SoundEngineOptions) {
    this.soundEnabled = options?.soundEnabled ?? true;
    this.musicEnabled = options?.musicEnabled ?? true;
    this.volume = clampVolume(options?.volume ?? 0.8);

    this.sfx = new Sfx(this.soundEnabled);
    this.music = new MagicalMusic(this.musicEnabled);
  }

  /**
   * Lazily initialize and resume the `AudioContext` inside a user gesture
   * (click, keyboard press, or DualSense button press). Safe in headless tests.
   */
  unlock(): void {
    if (this.disposed) return;
    this.unlocked = true;

    const ctx = this.ensureGraph();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx
        .resume()
        .then(() => {
          if (!this.disposed) {
            if (this.lastState) {
              this.music.updateState(this.lastState);
            }
            this.music.onContextResumed();
          }
        })
        .catch(() => {});
    }

    if (this.lastState) {
      this.music.updateState(this.lastState);
    }
  }

  /** Enable or mute sound effects smoothly without clicks or pops. */
  setSoundEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.soundEnabled = enabled;
    this.sfx.setEnabled(enabled);

    if (this.context && this.sfxGain && this.context.state !== 'closed') {
      smoothSetGain(this.sfxGain.gain, enabled ? SFX_BUS_GAIN : 0, this.context.currentTime, 0.03);
    }
  }

  /** Enable or mute background music smoothly without clicks or pops. */
  setMusicEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.musicEnabled = enabled;

    if (enabled && this.unlocked && !this.context) {
      this.ensureGraph();
    }
    this.music.setEnabled(enabled);
    if (enabled && this.unlocked && this.context && this.context.state === 'suspended') {
      void this.context.resume().catch(() => {});
    }
  }

  /** Smoothly adjust master volume in the range `0..1`. */
  setVolume(volume: number): void {
    if (this.disposed) return;
    this.volume = clampVolume(volume);

    if (this.context && this.masterGain && this.context.state !== 'closed') {
      smoothSetGain(this.masterGain.gain, this.volume, this.context.currentTime, 0.03);
    }
  }

  /** Sync music harmony, timbre, and phase ducking with the latest {@link GameState}. */
  updateMusicState(state: GameState): void {
    if (this.disposed) return;
    this.lastState = state;
    this.music.updateState(state);
    this.sfx.updateState(state);
  }

  /** Update continuous sound effects and music state. */
  updateState(state: GameState): void {
    this.updateMusicState(state);
  }

  /** Play the sound effect associated with a {@link GameEvent}. */
  onEvent(event: GameEvent, state: GameState): void {
    if (this.disposed || !this.soundEnabled) return;
    const ctx = this.ensureGraph();
    if (!ctx) return;

    if (ctx.state === 'suspended') {
      void ctx.resume().catch(() => {});
    }
    this.sfx.playEvent(event, state);
  }

  /** Stop all music/SFX and close the underlying `AudioContext`. */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    this.music.dispose();
    this.sfx.dispose();

    disconnectAll([this.sfxGain, this.musicGain, this.masterGain, this.compressor]);

    if (this.context && this.context.state !== 'closed') {
      void this.context.close().catch(() => {});
    }

    this.sfxGain = null;
    this.musicGain = null;
    this.masterGain = null;
    this.compressor = null;
    this.context = null;
    this.lastState = null;
  }

  private ensureGraph(): AudioContext | null {
    if (this.disposed) return null;
    if (this.context && this.context.state !== 'closed') {
      return this.context;
    }

    const Ctor = getSafeAudioContextConstructor();
    if (!Ctor) return null;

    let ctx: AudioContext;
    try {
      ctx = new Ctor();
    } catch {
      return null;
    }

    const now = ctx.currentTime;
    const masterGain = ctx.createGain();
    const musicGain = ctx.createGain();
    const sfxGain = ctx.createGain();

    masterGain.gain.setValueAtTime(this.volume, now);
    musicGain.gain.setValueAtTime(this.musicEnabled ? this.music.getTargetGain() : 0, now);
    sfxGain.gain.setValueAtTime(this.soundEnabled ? SFX_BUS_GAIN : 0, now);

    musicGain.connect(masterGain);
    sfxGain.connect(masterGain);

    let compressor: DynamicsCompressorNode | null = null;
    if (typeof ctx.createDynamicsCompressor === 'function') {
      compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-12, now);
      compressor.knee.setValueAtTime(18, now);
      compressor.ratio.setValueAtTime(3.5, now);
      compressor.attack.setValueAtTime(0.005, now);
      compressor.release.setValueAtTime(0.16, now);
      masterGain.connect(compressor);
      compressor.connect(ctx.destination);
    } else {
      masterGain.connect(ctx.destination);
    }

    this.context = ctx;
    this.masterGain = masterGain;
    this.musicGain = musicGain;
    this.sfxGain = sfxGain;
    this.compressor = compressor;

    this.sfx.attachOutput(ctx, sfxGain);
    this.music.attachOutput(ctx, musicGain);

    return ctx;
  }
}
