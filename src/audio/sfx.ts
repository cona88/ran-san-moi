/**
 * Synthesized sound effects via the Web Audio API — no external assets.
 *
 * The AudioContext is created lazily on the first sound so it starts inside a
 * user gesture (browser autoplay policy), and {@link resume} is called from
 * the first key/tap to unlock it.
 */
export class Sfx {
  private context: AudioContext | null = null;
  private enabled: boolean;

  constructor(enabled: boolean) {
    this.enabled = enabled;
  }

  setEnabled(enabled: boolean): void {
    this.enabled = enabled;
  }

  /** Unlock audio from within a user gesture. */
  resume(): void {
    void this.ensureContext()?.resume();
  }

  /** Rising blip when food is eaten. */
  eat(): void {
    this.blip(660, 990, 0.12, 'triangle');
  }

  /** Falling tone on crash / game over. */
  crash(): void {
    this.blip(320, 70, 0.45, 'sawtooth');
  }

  private ensureContext(): AudioContext | null {
    if (!this.enabled) return null;
    this.context ??= new AudioContext();
    return this.context;
  }

  private blip(startHz: number, endHz: number, duration: number, type: OscillatorType): void {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.type = type;
    osc.frequency.setValueAtTime(startHz, now);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), now + duration);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.25, now + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    osc.connect(gain).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + duration);
  }
}
