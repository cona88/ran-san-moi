import type { GamePhase, GameState, SnakeForm } from '../core/types';
import { disconnectAll, midiToHz, smoothSetGain } from './sfx';

type MusicTimbre = 'celesta' | 'crystal_bell' | 'harp' | 'marimba';

interface FormMusicProfile {
  readonly timbre: MusicTimbre;
  readonly stepSec: number;
  readonly chords: readonly (readonly [number, number, number])[];
  readonly melody: readonly (number | null)[];
  readonly hasWoodFlute?: boolean;
}

const PHASE_GAIN: Record<GamePhase, number> = {
  ready: 0.17,
  playing: 0.36,
  paused: 0.11,
  gameover: 0.13,
};

const FORM_PROFILES: Record<SnakeForm, FormMusicProfile> = {
  dragon: {
    timbre: 'celesta',
    stepSec: 0.33,
    chords: [
      [53, 60, 69], // Fmaj7
      [50, 57, 64], // Dm9
      [46, 53, 62], // Bbmaj7
      [48, 55, 64], // C6
      [53, 60, 69], // Fmaj7
      [57, 64, 72], // Am7
      [46, 53, 62], // Bbmaj7
      [48, 55, 62], // C9sus4
    ],
    melody: [
      77,
      null,
      81,
      79,
      77,
      null,
      72,
      null,
      74,
      null,
      77,
      79,
      81,
      null,
      null,
      79,
      74,
      77,
      81,
      null,
      79,
      77,
      74,
      null,
      72,
      null,
      74,
      76,
      79,
      null,
      null,
      null,
      77,
      null,
      81,
      84,
      81,
      null,
      79,
      null,
      81,
      null,
      84,
      81,
      79,
      null,
      76,
      null,
      74,
      77,
      79,
      81,
      84,
      null,
      81,
      79,
      79,
      null,
      77,
      74,
      72,
      null,
      null,
      null,
    ],
  },
  phoenix: {
    timbre: 'crystal_bell',
    stepSec: 0.35,
    chords: [
      [50, 57, 64], // Dadd9
      [47, 54, 62], // Bm7
      [55, 62, 66], // Gmaj7
      [57, 64, 66], // A6
      [50, 61, 66], // Dmaj7
      [54, 61, 69], // F#m7
      [55, 62, 66], // Gmaj7
      [57, 62, 64], // Asus4
    ],
    melody: [
      86,
      null,
      81,
      null,
      83,
      86,
      88,
      null,
      83,
      null,
      81,
      78,
      81,
      null,
      74,
      null,
      79,
      null,
      83,
      86,
      83,
      null,
      81,
      null,
      81,
      83,
      86,
      null,
      88,
      null,
      null,
      null,
      86,
      null,
      85,
      81,
      83,
      null,
      78,
      null,
      81,
      null,
      85,
      81,
      78,
      null,
      81,
      null,
      79,
      83,
      86,
      null,
      88,
      86,
      83,
      null,
      81,
      null,
      78,
      76,
      74,
      null,
      null,
      null,
    ],
  },
  unicorn: {
    timbre: 'harp',
    stepSec: 0.28,
    chords: [
      [55, 62, 71], // Gmaj7
      [52, 59, 66], // Em9
      [48, 55, 64], // Cmaj7
      [50, 57, 62], // D6
      [55, 62, 71], // Gmaj7
      [47, 54, 62], // Bm7
      [48, 55, 62], // Cmaj9
      [50, 55, 60], // D7sus4
    ],
    melody: [
      67,
      71,
      74,
      78,
      79,
      null,
      83,
      79,
      76,
      79,
      83,
      null,
      81,
      78,
      76,
      null,
      72,
      76,
      79,
      83,
      84,
      null,
      83,
      79,
      74,
      78,
      81,
      null,
      79,
      78,
      74,
      null,
      79,
      83,
      86,
      null,
      83,
      79,
      74,
      null,
      71,
      74,
      78,
      81,
      83,
      null,
      81,
      78,
      72,
      74,
      76,
      79,
      83,
      84,
      83,
      79,
      74,
      79,
      81,
      null,
      79,
      null,
      74,
      null,
    ],
  },
  spirit: {
    timbre: 'marimba',
    stepSec: 0.34,
    hasWoodFlute: true,
    chords: [
      [48, 55, 62], // Cmaj9
      [45, 52, 60], // Am7
      [53, 60, 64], // Fmaj7
      [55, 62, 64], // G6
      [48, 55, 64], // Cmaj7
      [52, 59, 62], // Em7
      [53, 60, 67], // Fadd9
      [55, 60, 62], // Gsus4
    ],
    melody: [
      72,
      null,
      76,
      79,
      76,
      null,
      74,
      null,
      69,
      null,
      72,
      76,
      79,
      null,
      76,
      null,
      77,
      null,
      76,
      74,
      72,
      null,
      69,
      null,
      74,
      null,
      76,
      79,
      81,
      null,
      79,
      null,
      72,
      76,
      79,
      null,
      84,
      null,
      81,
      79,
      76,
      null,
      79,
      81,
      79,
      null,
      74,
      null,
      77,
      null,
      81,
      79,
      76,
      null,
      74,
      null,
      79,
      null,
      76,
      74,
      72,
      null,
      null,
      null,
    ],
  },
};

const LOOKAHEAD_SEC = 0.24;
const SCHEDULER_INTERVAL_MS = 85;

/**
 * Polyphonic fairytale background music synthesizer.
 *
 * Uses Web Audio lookahead scheduling with gentle music-box / celesta / ice-bell /
 * harp / marimba-flute voices and warm filtered pads tailored for each {@link SnakeForm}.
 */
export class MagicalMusic {
  private context: AudioContext | null = null;
  private musicGain: GainNode | null = null;
  private enabled: boolean;
  private disposed = false;

  private form: SnakeForm = 'dragon';
  private phase: GamePhase = 'ready';
  private bossActive = false;
  private butterflyActive = false;
  private sprayActive = false;
  private chompHot = false;
  private stepIndex = 0;
  private nextNoteTime = 0;
  private lastPadForm: SnakeForm | null = null;
  private timerId: ReturnType<typeof setInterval> | null = null;
  private readonly activeSources = new Set<AudioScheduledSourceNode>();
  /** Last gain target handed to the music bus; skips redundant per-tick automation. */
  private lastAppliedGain = Number.NaN;

  constructor(enabled = true) {
    this.enabled = enabled;
  }

  /** Attach the shared `AudioContext` and `musicGain` bus managed by `SoundEngine`. */
  attachOutput(context: AudioContext, musicGain: GainNode): void {
    if (this.disposed) return;
    this.context = context;
    this.musicGain = musicGain;
    this.applyGainForState(true);
    this.syncScheduler();
  }

  /** Enable or mute background music cleanly. */
  setEnabled(enabled: boolean): void {
    if (this.disposed) return;
    this.enabled = enabled;
    this.applyGainForState();
    this.syncScheduler();
  }

  /** Update target harmony/timbre, boss energy, and phase ducking from the current {@link GameState}. */
  updateState(state: GameState): void {
    if (this.disposed) return;
    this.form = state.form;
    this.phase = state.phase;
    this.bossActive = state.activeBossId !== null;
    this.butterflyActive = state.butterflyStage === 'butterfly';
    this.sprayActive = state.sprayActiveTicks > 0;
    this.chompHot = state.chompStreak >= 2;
    this.applyGainForState();
    this.syncScheduler();
  }

  /** Alias for {@link updateState} matching {@link SoundEngine.updateMusicState}. */
  updateMusicState(state: GameState): void {
    this.updateState(state);
  }

  /** Expose the desired gain level for the current enable flag, game phase, and dynamic energy state. */
  getTargetGain(): number {
    if (!this.enabled) return 0;
    const base = PHASE_GAIN[this.phase];
    if (this.phase !== 'playing') return base;

    let lift = 0;
    if (this.bossActive) lift += 0.04;
    if (this.butterflyActive) lift += 0.024;
    if (this.sprayActive) lift += 0.014;
    if (this.chompHot) lift += 0.018;
    return Math.min(0.42, Number((base + lift).toFixed(3)));
  }

  /** Immediately re-sync gain and lookahead scheduling once `AudioContext.resume()` completes. */
  onContextResumed(): void {
    if (this.disposed) return;
    this.applyGainForState(true);
    this.syncScheduler();
    this.pumpSchedule();
  }

  /** Stop the scheduler and release active scheduled voices. */
  dispose(): void {
    this.disposed = true;
    this.stopScheduler();
    for (const src of this.activeSources) {
      try {
        src.stop();
      } catch {
        // Already stopped
      }
      try {
        src.disconnect();
      } catch {
        // Already disconnected
      }
    }
    this.activeSources.clear();
    this.context = null;
    this.musicGain = null;
  }

  private applyGainForState(force = false): void {
    const ctx = this.context;
    const gain = this.musicGain;
    if (!ctx || !gain || ctx.state === 'closed') return;
    const target = this.getTargetGain();
    // updateState runs every game tick; re-anchoring an unchanged target only churns automation events.
    if (!force && target === this.lastAppliedGain) return;
    this.lastAppliedGain = target;
    smoothSetGain(gain.gain, target, ctx.currentTime, 0.22);
  }

  private syncScheduler(): void {
    if (this.disposed || !this.enabled || !this.context || !this.musicGain) {
      this.stopScheduler();
      return;
    }
    if (this.context.state === 'closed') {
      this.stopScheduler();
      return;
    }
    if (this.timerId !== null) return;

    this.nextNoteTime = this.context.currentTime + 0.05;
    this.timerId = setInterval(() => this.pumpSchedule(), SCHEDULER_INTERVAL_MS);
    this.pumpSchedule();
  }

  private stopScheduler(): void {
    if (this.timerId !== null) {
      clearInterval(this.timerId);
      this.timerId = null;
    }
  }

  private pumpSchedule(): void {
    const ctx = this.context;
    const dest = this.musicGain;
    if (this.disposed || !this.enabled || !ctx || !dest || ctx.state === 'closed') {
      this.stopScheduler();
      return;
    }
    if (ctx.state === 'suspended') {
      return;
    }

    // Prevent burst catch-up if tab was backgrounded or suspended.
    if (ctx.currentTime - this.nextNoteTime > 0.5) {
      this.nextNoteTime = ctx.currentTime + 0.04;
    }

    const profile = FORM_PROFILES[this.form];
    const hasEnergyLift =
      this.phase === 'playing' && (this.butterflyActive || this.sprayActive || this.chompHot);
    while (this.nextNoteTime < ctx.currentTime + LOOKAHEAD_SEC) {
      this.scheduleStep(ctx, dest, profile, this.stepIndex, this.nextNoteTime);
      const paceMultiplier =
        this.phase === 'paused' || this.phase === 'gameover'
          ? 1.15
          : this.bossActive && this.phase === 'playing'
            ? 0.84
            : hasEnergyLift
              ? 0.94
              : 1;
      this.nextNoteTime += profile.stepSec * paceMultiplier;
      this.stepIndex = (this.stepIndex + 1) % profile.melody.length;
    }
  }

  private scheduleStep(
    ctx: AudioContext,
    dest: AudioNode,
    profile: FormMusicProfile,
    step: number,
    time: number,
  ): void {
    const barIndex = Math.floor(step / 8) % profile.chords.length;
    const stepInBar = step % 8;
    const chord = profile.chords[barIndex] ?? [48, 55, 62];
    const calmPhase = this.phase === 'paused' || this.phase === 'gameover';
    const bossUplift = this.bossActive && this.phase === 'playing';
    const energyLift =
      this.phase === 'playing' && (this.butterflyActive || this.sprayActive || this.chompHot);

    // Refresh warm harmonic pad + octave shimmer layer at each bar boundary or form morph.
    if (stepInBar === 0 || this.lastPadForm !== this.form) {
      this.lastPadForm = this.form;
      const padDuration = profile.stepSec * Math.max(2, 8 - stepInBar);
      this.scheduleWarmPad(ctx, dest, chord, time, padDuration, energyLift || bossUplift);
      if (
        profile.hasWoodFlute &&
        stepInBar === 0 &&
        (this.phase === 'playing' || this.phase === 'ready')
      ) {
        this.scheduleWoodFlute(ctx, dest, midiToHz(chord[2] + 12), time, profile.stepSec * 5.2);
      }
      if (this.butterflyActive && this.phase === 'playing' && stepInBar === 0) {
        this.scheduleOctavePadShimmer(
          ctx,
          dest,
          midiToHz(chord[1] + 24),
          time,
          profile.stepSec * 4.6,
          0.017,
          -0.26,
        );
        this.scheduleOctavePadShimmer(
          ctx,
          dest,
          midiToHz(chord[2] + 24),
          time,
          profile.stepSec * 4.6,
          0.02,
          0.26,
        );
      }
    }

    // Gentle accompaniment pulse on beat 1 & 3 (or softly on step 0 & 4)
    if (
      stepInBar === 0 ||
      (!calmPhase && (stepInBar === 2 || stepInBar === 4 || stepInBar === 6))
    ) {
      const chordTone = chord[stepInBar % chord.length] ?? chord[0];
      this.schedulePulseVoice(
        ctx,
        dest,
        midiToHz(chordTone + 12),
        time,
        profile.stepSec * 1.4,
        profile.timbre,
      );
    }

    // Subtle fairytale octave shimmer chime on beats 2 & 4
    if (!calmPhase && (stepInBar === 2 || stepInBar === 6)) {
      const shimmerTone = chord[(barIndex + (stepInBar === 2 ? 1 : 2)) % chord.length] ?? chord[2];
      this.schedulePulseVoice(
        ctx,
        dest,
        midiToHz(shimmerTone + 24),
        time,
        profile.stepSec * 1.35,
        profile.timbre,
        energyLift ? 0.022 : 0.015,
        true,
        stepInBar === 2 ? -0.32 : 0.32,
      );
    }

    // Dynamic energy lift during Boss encounters OR butterfly / active spray / chomp streak
    if (bossUplift) {
      if (stepInBar === 0 || stepInBar === 4) {
        this.schedulePulseVoice(
          ctx,
          dest,
          midiToHz(chord[0]),
          time,
          profile.stepSec * 1.35,
          profile.timbre,
          0.044,
          true,
        );
      } else if (stepInBar % 2 === 1) {
        const offBeatTone = chord[(stepInBar + 1) % chord.length] ?? chord[1];
        this.schedulePulseVoice(
          ctx,
          dest,
          midiToHz(offBeatTone + 12),
          time,
          profile.stepSec * 0.88,
          profile.timbre,
          0.028,
        );
      }
    } else if (energyLift) {
      if (stepInBar === 0 || stepInBar === 4) {
        this.schedulePulseVoice(
          ctx,
          dest,
          midiToHz(chord[0]),
          time,
          profile.stepSec * 1.3,
          profile.timbre,
          0.032,
          true,
        );
      } else if (stepInBar % 2 === 1) {
        const liftTone = chord[(stepInBar + 1) % chord.length] ?? chord[1];
        this.schedulePulseVoice(
          ctx,
          dest,
          midiToHz(liftTone + 24),
          time,
          profile.stepSec * 0.95,
          profile.timbre,
          0.02,
          true,
          stepInBar === 1 || stepInBar === 5 ? -0.28 : 0.28,
        );
      }
    }

    // Crystal butterfly sparkle bell layer on off-beats while soaring
    if (this.butterflyActive && this.phase === 'playing' && stepInBar % 2 === 1) {
      const crystalTone = chord[(barIndex + stepInBar) % chord.length] ?? chord[2];
      this.playBellNote(
        ctx,
        dest,
        midiToHz(crystalTone + 24),
        time,
        profile.stepSec * 1.45,
        0.028,
        3,
        0.12,
        1.4,
        stepInBar === 1 || stepInBar === 5 ? -0.3 : 0.3,
      );
    }

    // Main fairy-tale melody voice (sparser during paused/gameover so it feels peaceful)
    if (calmPhase && stepInBar % 2 !== 0) return;
    const note = profile.melody[step];
    if (note !== null && note !== undefined) {
      this.scheduleLeadVoice(ctx, dest, midiToHz(note), time, profile.timbre);
    }
  }

  private scheduleWarmPad(
    ctx: AudioContext,
    dest: AudioNode,
    chord: readonly [number, number, number],
    startTime: number,
    duration: number,
    energized = false,
  ): void {
    const safeDur = Math.max(0.5, duration);
    const fadeIn = Math.min(0.45, safeDur * 0.3);
    const endTime = startTime + safeDur + 0.35;

    for (const midi of chord) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      const cleanupNodes: AudioNode[] = [osc, gain];

      osc.type = 'triangle';
      osc.frequency.setValueAtTime(midiToHz(midi), startTime);

      gain.gain.setValueAtTime(0.0001, startTime);
      gain.gain.exponentialRampToValueAtTime(0.04, startTime + fadeIn);
      gain.gain.setValueAtTime(0.04, startTime + safeDur * 0.72);
      gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

      let tail: AudioNode = osc;
      if (typeof ctx.createBiquadFilter === 'function') {
        const filter = ctx.createBiquadFilter();
        filter.type = 'lowpass';
        filter.frequency.setValueAtTime(energized ? 820 : 680, startTime);
        tail.connect(filter);
        tail = filter;
        cleanupNodes.push(filter);
      }

      tail.connect(gain);
      gain.connect(dest);
      this.trackAndStop(osc, endTime + 0.02, cleanupNodes, startTime);
    }

    // Soft octave shimmer pad layer (+12 semitones on root & fifth) for warm fairytale glow
    const shimmerPeak = energized ? 0.02 : 0.013;
    this.scheduleOctavePadShimmer(
      ctx,
      dest,
      midiToHz(chord[1] + 12),
      startTime,
      safeDur,
      shimmerPeak,
      -0.22,
    );
    this.scheduleOctavePadShimmer(
      ctx,
      dest,
      midiToHz(chord[2] + 12),
      startTime,
      safeDur,
      shimmerPeak * 0.85,
      0.22,
    );
  }

  private scheduleOctavePadShimmer(
    ctx: AudioContext,
    dest: AudioNode,
    hz: number,
    startTime: number,
    duration: number,
    peakGain: number,
    pan = 0,
  ): void {
    const safeDur = Math.max(0.4, duration);
    const fadeIn = Math.min(0.5, safeDur * 0.35);
    const endTime = startTime + safeDur + 0.35;

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const cleanupNodes: AudioNode[] = [osc, gain];

    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(Math.max(0.0005, peakGain), startTime + fadeIn);
    gain.gain.setValueAtTime(Math.max(0.0005, peakGain), startTime + safeDur * 0.68);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    let tail: AudioNode = osc;
    if (typeof ctx.createBiquadFilter === 'function') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(1350, startTime);
      tail.connect(filter);
      tail = filter;
      cleanupNodes.push(filter);
    }

    tail.connect(gain);

    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), startTime);
      gain.connect(panner);
      panner.connect(dest);
      cleanupNodes.push(panner);
    } else {
      gain.connect(dest);
    }

    this.trackAndStop(osc, endTime + 0.02, cleanupNodes, startTime);
  }

  private schedulePulseVoice(
    ctx: AudioContext,
    dest: AudioNode,
    hz: number,
    startTime: number,
    duration: number,
    timbre: MusicTimbre,
    peakGain = 0.045,
    forceSine = false,
    pan = 0,
  ): void {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const cleanupNodes: AudioNode[] = [osc, gain];
    const endTime = startTime + Math.max(0.18, duration);

    osc.type = !forceSine && timbre === 'harp' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(hz, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peakGain, startTime + 0.014);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    osc.connect(gain);
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), startTime);
      gain.connect(panner);
      panner.connect(dest);
      cleanupNodes.push(panner);
    } else {
      gain.connect(dest);
    }
    this.trackAndStop(osc, endTime + 0.02, cleanupNodes, startTime);
  }

  private scheduleLeadVoice(
    ctx: AudioContext,
    dest: AudioNode,
    hz: number,
    startTime: number,
    timbre: MusicTimbre,
  ): void {
    switch (timbre) {
      case 'celesta':
        this.playBellNote(ctx, dest, hz, startTime, 0.65, 0.11, 2, 0.18, 0);
        return;
      case 'crystal_bell':
        this.playBellNote(ctx, dest, hz, startTime, 0.85, 0.095, 3, 0.08, 1.3);
        return;
      case 'harp':
        this.playHarpNote(ctx, dest, hz, startTime);
        return;
      case 'marimba':
        this.playMarimbaNote(ctx, dest, hz, startTime);
        return;
    }
  }

  private playBellNote(
    ctx: AudioContext,
    dest: AudioNode,
    hz: number,
    startTime: number,
    duration: number,
    peak: number,
    overtoneRatio: number,
    overtoneFactor: number,
    shimmerDetuneHz: number,
    pan = 0,
  ): void {
    const endTime = startTime + duration;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const cleanupNodes: AudioNode[] = [osc, gain];
    osc.type = 'sine';
    osc.frequency.setValueAtTime(hz, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(peak, startTime + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    let outputNode: AudioNode = dest;
    if (pan !== 0 && typeof ctx.createStereoPanner === 'function') {
      const panner = ctx.createStereoPanner();
      panner.pan.setValueAtTime(Math.max(-1, Math.min(1, pan)), startTime);
      panner.connect(dest);
      outputNode = panner;
      cleanupNodes.push(panner);
    }

    osc.connect(gain);
    gain.connect(outputNode);
    this.trackAndStop(osc, endTime + 0.02, cleanupNodes, startTime);

    // Subtle bell overtone
    const over = ctx.createOscillator();
    const overGain = ctx.createGain();
    const overEnd = startTime + duration * 0.65;
    over.type = 'sine';
    over.frequency.setValueAtTime(hz * overtoneRatio + shimmerDetuneHz, startTime);
    overGain.gain.setValueAtTime(0.0001, startTime);
    overGain.gain.exponentialRampToValueAtTime(
      Math.max(0.0005, peak * overtoneFactor),
      startTime + 0.007,
    );
    overGain.gain.exponentialRampToValueAtTime(0.0001, overEnd);

    over.connect(overGain);
    overGain.connect(outputNode);
    this.trackAndStop(over, overEnd + 0.02, [over, overGain], startTime);
  }

  private playHarpNote(ctx: AudioContext, dest: AudioNode, hz: number, startTime: number): void {
    const endTime = startTime + 0.48;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const cleanupNodes: AudioNode[] = [osc, gain];

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hz, startTime);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.115, startTime + 0.007);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    let tail: AudioNode = osc;
    if (typeof ctx.createBiquadFilter === 'function') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(2100, startTime);
      filter.frequency.exponentialRampToValueAtTime(620, endTime);
      tail.connect(filter);
      tail = filter;
      cleanupNodes.push(filter);
    }

    tail.connect(gain);
    gain.connect(dest);
    this.trackAndStop(osc, endTime + 0.02, cleanupNodes, startTime);
  }

  private playMarimbaNote(ctx: AudioContext, dest: AudioNode, hz: number, startTime: number): void {
    const endTime = startTime + 0.3;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    // Gentle woody mallet transient settling onto fundamental pitch
    osc.frequency.setValueAtTime(hz * 1.03, startTime);
    if (typeof osc.frequency.exponentialRampToValueAtTime === 'function') {
      osc.frequency.exponentialRampToValueAtTime(hz, startTime + 0.015);
    }

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.13, startTime + 0.006);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    osc.connect(gain);
    gain.connect(dest);
    this.trackAndStop(osc, endTime + 0.02, [osc, gain], startTime);
  }

  private scheduleWoodFlute(
    ctx: AudioContext,
    dest: AudioNode,
    hz: number,
    startTime: number,
    duration: number,
  ): void {
    const safeDur = Math.max(0.4, duration);
    const endTime = startTime + safeDur;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const cleanupNodes: AudioNode[] = [osc, gain];

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(hz, startTime);

    // Subtle gentle vibrato LFO
    const lfo = ctx.createOscillator();
    const lfoGain = ctx.createGain();
    lfo.type = 'sine';
    lfo.frequency.setValueAtTime(4.8, startTime);
    lfoGain.gain.setValueAtTime(3.2, startTime);
    lfo.connect(lfoGain);
    try {
      lfoGain.connect(osc.frequency);
    } catch {
      // Optional AudioParam connection in minimal mocks
    }
    cleanupNodes.push(lfo, lfoGain);

    gain.gain.setValueAtTime(0.0001, startTime);
    gain.gain.exponentialRampToValueAtTime(0.052, startTime + 0.14);
    gain.gain.setValueAtTime(0.052, startTime + safeDur * 0.7);
    gain.gain.exponentialRampToValueAtTime(0.0001, endTime);

    let tail: AudioNode = osc;
    if (typeof ctx.createBiquadFilter === 'function') {
      const filter = ctx.createBiquadFilter();
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(920, startTime);
      tail.connect(filter);
      tail = filter;
      cleanupNodes.push(filter);
    }

    tail.connect(gain);
    gain.connect(dest);

    this.trackAndStop(lfo, endTime + 0.02, [], startTime);
    this.trackAndStop(osc, endTime + 0.02, cleanupNodes, startTime);
  }

  private trackAndStop(
    src: AudioScheduledSourceNode,
    stopTime: number,
    cleanupNodes: readonly AudioNode[],
    startTime: number,
  ): void {
    this.activeSources.add(src);
    src.onended = () => {
      this.activeSources.delete(src);
      disconnectAll(cleanupNodes);
    };
    src.start(startTime);
    src.stop(stopTime);
  }
}
