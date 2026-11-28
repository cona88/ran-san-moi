/**
 * Live 3D regional weather particles & low-altitude mist wisps across all 7 kingdom climates.
 *
 * Uses exactly 2 GPU `InstancedMesh`es (~220 weather particles + ~28 soft mist wisps),
 * deterministic seeded PRNG (zero `Math.random()`), zero per-frame heap allocations in `draw()`,
 * and full GPU disposal in `dispose()`.
 */
import {
  Color,
  DynamicDrawUsage,
  Euler,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  OctahedronGeometry,
  Quaternion,
  SphereGeometry,
  Vector3,
  type Scene,
} from 'three';
import { getRegionAt } from '../core/adventure';
import type { AdventureRegionId, GameState, VisualTheme } from '../core/types';

const WEATHER_PARTICLE_COUNT = 220;
const MIST_WISP_COUNT = 28;
const WEATHER_BOX_SPAN = 48;
const WEATHER_HEIGHT_SPAN = 13.5;
const WEATHER_BASE_Y = 0.25;
const MIST_BOX_SPAN = 64;

interface SeededRng {
  next(): number;
}

function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  return {
    next(): number {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = Math.imul(state ^ (state >>> 15), 1 | state);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    },
  };
}

function wrapAroundFocus(base: number, focus: number, span: number): number {
  const half = span * 0.5;
  const rel = ((((base - focus + half) % span) + span) % span) - half;
  return focus + rel;
}

function wrapPositive(val: number, span: number): number {
  return ((val % span) + span) % span;
}

interface WeatherSeed {
  readonly offsetX: number;
  readonly offsetY: number;
  readonly offsetZ: number;
  readonly driftFreq: number;
  readonly phase: number;
  readonly scaleVar: number;
  readonly spinSpeed: number;
  readonly colorSlot: number;
}

interface MistSeed {
  readonly offsetX: number;
  readonly baseY: number;
  readonly offsetZ: number;
  readonly radiusX: number;
  readonly radiusZ: number;
  readonly driftX: number;
  readonly driftZ: number;
  readonly phase: number;
  readonly colorSlot: number;
}

interface ClimateWeatherProfile {
  readonly colors: readonly [number, number, number, number];
  readonly mistColors: readonly [number, number];
  readonly mistOpacity: number;
  readonly weatherOpacity: number;
  readonly vx: number;
  readonly vy: number;
  readonly vz: number;
  readonly swayAmp: number;
  readonly swaySpeed: number;
  readonly scaleXYZ: readonly [number, number, number];
  readonly spinMult: number;
  readonly blinkAmp: number;
  readonly mistScaleMult: number;
}

const CLIMATE_WEATHER_PROFILES: Readonly<Record<AdventureRegionId, ClimateWeatherProfile>> = {
  royal_citadel: {
    // Golden floating pollen motes & soft warm sun haze
    colors: [0xffe066, 0xfff3b0, 0xffc83d, 0xffe98a],
    mistColors: [0xfff0c8, 0xffe4a8],
    mistOpacity: 0.085,
    weatherOpacity: 0.84,
    vx: 0.65,
    vy: 0.24,
    vz: 0.35,
    swayAmp: 0.85,
    swaySpeed: 1.25,
    scaleXYZ: [0.78, 0.78, 0.78],
    spinMult: 0.7,
    blinkAmp: 0.26,
    mistScaleMult: 0.85,
  },
  mushroom_woods: {
    // Warm amber & emerald fireflies + humid forest mist wisps
    colors: [0x6ef7a7, 0xffd24d, 0xa8ff78, 0x38e89e],
    mistColors: [0x6de0b8, 0xa2f2d2],
    mistOpacity: 0.22,
    weatherOpacity: 0.92,
    vx: 0.28,
    vy: 0.14,
    vz: -0.22,
    swayAmp: 1.35,
    swaySpeed: 1.65,
    scaleXYZ: [0.92, 0.92, 0.92],
    spinMult: 0.5,
    blinkAmp: 0.58,
    mistScaleMult: 1.32,
  },
  blossom_valley: {
    // Fluttering pink & white sakura petals
    colors: [0xff9ed2, 0xffc7e6, 0xfff4f8, 0xff75bd],
    mistColors: [0xffd8eb, 0xffeef6],
    mistOpacity: 0.105,
    weatherOpacity: 0.92,
    vx: 1.85,
    vy: -1.15,
    vz: 0.95,
    swayAmp: 1.45,
    swaySpeed: 1.9,
    scaleXYZ: [1.48, 0.22, 1.08],
    spinMult: 2.35,
    blinkAmp: 0.14,
    mistScaleMult: 0.95,
  },
  crystal_sanctum: {
    // Falling snowflakes & sparkling diamond dust
    colors: [0xe8fbff, 0x9eeeff, 0xffffff, 0x76dcff],
    mistColors: [0xcff4ff, 0xe8faff],
    mistOpacity: 0.17,
    weatherOpacity: 0.94,
    vx: 0.52,
    vy: -2.25,
    vz: 0.42,
    swayAmp: 0.9,
    swaySpeed: 1.45,
    scaleXYZ: [1.08, 0.48, 1.08],
    spinMult: 1.65,
    blinkAmp: 0.3,
    mistScaleMult: 1.15,
  },
  mermaid_lagoon: {
    // Shimmering sea-spray & rising turquoise bubbles
    colors: [0x54f2ff, 0xa8fbff, 0x22d8ee, 0xe8ffff],
    mistColors: [0x8ef2ff, 0xc4fbff],
    mistOpacity: 0.135,
    weatherOpacity: 0.88,
    vx: 0.45,
    vy: 1.55,
    vz: -0.35,
    swayAmp: 0.95,
    swaySpeed: 1.75,
    scaleXYZ: [0.96, 0.96, 0.96],
    spinMult: 0.65,
    blinkAmp: 0.28,
    mistScaleMult: 1.05,
  },
  candy_highlands: {
    // Golden-peach meadow sparkles & floating fluff
    colors: [0xffd082, 0xffa8b8, 0xfff0c2, 0xffb978],
    mistColors: [0xffe0ba, 0xffd0c4],
    mistOpacity: 0.1,
    weatherOpacity: 0.88,
    vx: 1.05,
    vy: 0.42,
    vz: 0.6,
    swayAmp: 1.15,
    swaySpeed: 1.4,
    scaleXYZ: [1.02, 0.82, 1.02],
    spinMult: 1.15,
    blinkAmp: 0.25,
    mistScaleMult: 0.92,
  },
  starlight_peaks: {
    // Silver-violet star-snow & aurora mist wisps
    colors: [0xdcc2ff, 0xf2ecff, 0x8cf8ff, 0xb388ff],
    mistColors: [0x9c8eff, 0x76e8ff],
    mistOpacity: 0.19,
    weatherOpacity: 0.92,
    vx: -0.65,
    vy: -1.45,
    vz: 0.55,
    swayAmp: 1.15,
    swaySpeed: 1.55,
    scaleXYZ: [1.06, 0.56, 1.06],
    spinMult: 1.8,
    blinkAmp: 0.42,
    mistScaleMult: 1.24,
  },
};

/**
 * Renders live, smoothly-transitioning 3D regional weather particles and low-altitude
 * atmospheric mist wisps centered around the player's world camera focus.
 */
export class ClimateWeather3DView {
  private readonly weatherGeo = new OctahedronGeometry(0.16, 0);
  private readonly weatherMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.88,
    depthWrite: false,
  });
  private readonly weatherMesh: InstancedMesh;

  private readonly mistGeo = new SphereGeometry(1, 10, 8);
  private readonly mistMat = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.14,
    depthWrite: false,
  });
  private readonly mistMesh: InstancedMesh;

  private readonly weatherSeeds: WeatherSeed[] = [];
  private readonly mistSeeds: MistSeed[] = [];
  private readonly weatherColors: Color[] = [];
  private readonly mistColors: Color[] = [];

  private readonly scratchMatrix = new Matrix4();
  private readonly scratchPos = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly scratchEuler = new Euler();
  private readonly scratchQuat = new Quaternion();
  private readonly scratchTargetColor = new Color();

  private activeTheme: VisualTheme = 'honeycomb_arena';
  private activeRegion: AdventureRegionId = 'royal_citadel';
  private smoothFocusX = 0;
  private smoothFocusZ = 0;
  private hasFocusSnap = false;

  // Smoothed kinematic weather parameters (zero heap allocations during draw)
  private curVx = CLIMATE_WEATHER_PROFILES.royal_citadel.vx;
  private curVy = CLIMATE_WEATHER_PROFILES.royal_citadel.vy;
  private curVz = CLIMATE_WEATHER_PROFILES.royal_citadel.vz;
  private curSwayAmp = CLIMATE_WEATHER_PROFILES.royal_citadel.swayAmp;
  private curSwaySpeed = CLIMATE_WEATHER_PROFILES.royal_citadel.swaySpeed;
  private curScaleX = CLIMATE_WEATHER_PROFILES.royal_citadel.scaleXYZ[0];
  private curScaleY = CLIMATE_WEATHER_PROFILES.royal_citadel.scaleXYZ[1];
  private curScaleZ = CLIMATE_WEATHER_PROFILES.royal_citadel.scaleXYZ[2];
  private curSpinMult = CLIMATE_WEATHER_PROFILES.royal_citadel.spinMult;
  private curBlinkAmp = CLIMATE_WEATHER_PROFILES.royal_citadel.blinkAmp;
  private curMistScaleMult = CLIMATE_WEATHER_PROFILES.royal_citadel.mistScaleMult;
  private curWeatherOpacity = CLIMATE_WEATHER_PROFILES.royal_citadel.weatherOpacity;
  private curMistOpacity = CLIMATE_WEATHER_PROFILES.royal_citadel.mistOpacity;
  private colorBlendRemaining = 0;

  private driftX = 0;
  private driftY = 0;
  private driftZ = 0;

  constructor(private readonly scene: Scene) {
    this.weatherMesh = new InstancedMesh(this.weatherGeo, this.weatherMat, WEATHER_PARTICLE_COUNT);
    this.weatherMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.weatherMesh.frustumCulled = false;

    this.mistMesh = new InstancedMesh(this.mistGeo, this.mistMat, MIST_WISP_COUNT);
    this.mistMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.mistMesh.frustumCulled = false;

    const rng = createSeededRng(0x5c1a7e33);
    const initialProfile = CLIMATE_WEATHER_PROFILES.royal_citadel;

    for (let i = 0; i < WEATHER_PARTICLE_COUNT; i++) {
      const slot = i % 4;
      this.weatherSeeds.push({
        offsetX: (rng.next() - 0.5) * WEATHER_BOX_SPAN,
        offsetY: rng.next() * WEATHER_HEIGHT_SPAN,
        offsetZ: (rng.next() - 0.5) * WEATHER_BOX_SPAN,
        driftFreq: 0.75 + rng.next() * 0.7,
        phase: rng.next() * Math.PI * 2,
        scaleVar: 0.68 + rng.next() * 0.64,
        spinSpeed: (rng.next() > 0.5 ? 1 : -1) * (0.6 + rng.next() * 1.4),
        colorSlot: slot,
      });
      const col = new Color(initialProfile.colors[slot]!);
      this.weatherColors.push(col);
      this.weatherMesh.setColorAt(i, col);
    }
    if (this.weatherMesh.instanceColor) {
      this.weatherMesh.instanceColor.needsUpdate = true;
    }

    for (let i = 0; i < MIST_WISP_COUNT; i++) {
      const slot = i % 2;
      this.mistSeeds.push({
        offsetX: (rng.next() - 0.5) * MIST_BOX_SPAN,
        baseY: 0.55 + rng.next() * 2.4,
        offsetZ: (rng.next() - 0.5) * MIST_BOX_SPAN,
        radiusX: 3.4 + rng.next() * 3.8,
        radiusZ: 2.5 + rng.next() * 3.1,
        driftX: (rng.next() - 0.5) * 0.9,
        driftZ: (rng.next() - 0.5) * 0.7,
        phase: rng.next() * Math.PI * 2,
        colorSlot: slot,
      });
      const col = new Color(initialProfile.mistColors[slot]!);
      this.mistColors.push(col);
      this.mistMesh.setColorAt(i, col);
    }
    if (this.mistMesh.instanceColor) {
      this.mistMesh.instanceColor.needsUpdate = true;
    }

    this.scene.add(this.mistMesh);
    this.scene.add(this.weatherMesh);
  }

  /** Adapt weather opacity/contrast slightly when switching VisualThemes. */
  setTheme(theme: VisualTheme): void {
    this.activeTheme = theme;
  }

  /** Update regional weather particles and low-altitude mist wisps (zero per-frame allocations). */
  draw(elapsed: number, delta: number, state: GameState, focusPos: Vector3): void {
    const insideCastle = state.castleInterior !== null;
    this.weatherMesh.visible = !insideCastle;
    this.mistMesh.visible = !insideCastle;
    if (insideCastle) return;

    const dt = Math.min(Math.max(delta, 0), 0.1);
    const region = getRegionAt(focusPos);
    if (region.id !== this.activeRegion) {
      this.activeRegion = region.id;
      this.colorBlendRemaining = 3.2;
    }

    if (!this.hasFocusSnap) {
      this.smoothFocusX = focusPos.x;
      this.smoothFocusZ = focusPos.z;
      this.hasFocusSnap = true;
    } else {
      const focusSmooth = 1 - Math.exp(-8 * dt);
      this.smoothFocusX += (focusPos.x - this.smoothFocusX) * focusSmooth;
      this.smoothFocusZ += (focusPos.z - this.smoothFocusZ) * focusSmooth;
    }

    const profile = CLIMATE_WEATHER_PROFILES[this.activeRegion];
    const smooth = 1 - Math.exp(-2.1 * dt);

    this.curVx += (profile.vx - this.curVx) * smooth;
    this.curVy += (profile.vy - this.curVy) * smooth;
    this.curVz += (profile.vz - this.curVz) * smooth;
    this.curSwayAmp += (profile.swayAmp - this.curSwayAmp) * smooth;
    this.curSwaySpeed += (profile.swaySpeed - this.curSwaySpeed) * smooth;
    this.curScaleX += (profile.scaleXYZ[0] - this.curScaleX) * smooth;
    this.curScaleY += (profile.scaleXYZ[1] - this.curScaleY) * smooth;
    this.curScaleZ += (profile.scaleXYZ[2] - this.curScaleZ) * smooth;
    this.curSpinMult += (profile.spinMult - this.curSpinMult) * smooth;
    this.curBlinkAmp += (profile.blinkAmp - this.curBlinkAmp) * smooth;
    this.curMistScaleMult += (profile.mistScaleMult - this.curMistScaleMult) * smooth;

    const darkThemeMistBoost =
      this.activeTheme === 'starlight_galaxy' || this.activeTheme === 'crystal_garden' ? 0.88 : 1.0;
    this.curWeatherOpacity += (profile.weatherOpacity - this.curWeatherOpacity) * smooth;
    this.curMistOpacity +=
      (profile.mistOpacity * darkThemeMistBoost - this.curMistOpacity) * smooth;

    this.weatherMat.opacity = this.curWeatherOpacity;
    this.mistMat.opacity = this.curMistOpacity;

    this.driftX += this.curVx * dt;
    this.driftY += this.curVy * dt;
    this.driftZ += this.curVz * dt;

    // Smoothly transition instance colors only while settling after a border crossing.
    const updateColors = this.colorBlendRemaining > 0;
    if (updateColors) {
      this.colorBlendRemaining = Math.max(0, this.colorBlendRemaining - dt);
      const colorSmooth = Math.min(1, 1 - Math.exp(-2.4 * dt));

      for (let i = 0; i < WEATHER_PARTICLE_COUNT; i++) {
        const seed = this.weatherSeeds[i]!;
        const cur = this.weatherColors[i]!;
        this.scratchTargetColor.setHex(profile.colors[seed.colorSlot]!);
        cur.lerp(this.scratchTargetColor, colorSmooth);
        this.weatherMesh.setColorAt(i, cur);
      }
      if (this.weatherMesh.instanceColor) {
        this.weatherMesh.instanceColor.needsUpdate = true;
      }

      for (let i = 0; i < MIST_WISP_COUNT; i++) {
        const seed = this.mistSeeds[i]!;
        const cur = this.mistColors[i]!;
        this.scratchTargetColor.setHex(profile.mistColors[seed.colorSlot]!);
        cur.lerp(this.scratchTargetColor, colorSmooth);
        this.mistMesh.setColorAt(i, cur);
      }
      if (this.mistMesh.instanceColor) {
        this.mistMesh.instanceColor.needsUpdate = true;
      }
    }

    for (let i = 0; i < WEATHER_PARTICLE_COUNT; i++) {
      const s = this.weatherSeeds[i]!;
      const swayPhase = elapsed * this.curSwaySpeed * s.driftFreq + s.phase;
      const baseX = s.offsetX + this.driftX * s.driftFreq + Math.sin(swayPhase) * this.curSwayAmp;
      const baseZ =
        s.offsetZ + this.driftZ * s.driftFreq + Math.cos(swayPhase * 0.85) * this.curSwayAmp * 0.8;

      const wx = wrapAroundFocus(baseX, this.smoothFocusX, WEATHER_BOX_SPAN);
      const wz = wrapAroundFocus(baseZ, this.smoothFocusZ, WEATHER_BOX_SPAN);
      const wy =
        WEATHER_BASE_Y + wrapPositive(s.offsetY + this.driftY * s.driftFreq, WEATHER_HEIGHT_SPAN);

      // Gentle fade at top/bottom bounds so recycling is invisible
      const yNorm = (wy - WEATHER_BASE_Y) / WEATHER_HEIGHT_SPAN;
      const edgeFade = Math.min(1, yNorm * 7) * Math.min(1, (1 - yNorm) * 7);
      const blink = 1 - this.curBlinkAmp * (0.5 + 0.5 * Math.sin(elapsed * 3.1 + s.phase * 2.3));
      const scaleFactor = s.scaleVar * edgeFade * blink;

      this.scratchPos.set(wx, wy, wz);
      this.scratchScale.set(
        this.curScaleX * scaleFactor,
        this.curScaleY * scaleFactor,
        this.curScaleZ * scaleFactor,
      );
      this.scratchEuler.set(
        elapsed * s.spinSpeed * this.curSpinMult * 0.7 + s.phase,
        elapsed * s.spinSpeed * this.curSpinMult + s.phase,
        Math.sin(swayPhase) * 0.45 * this.curSpinMult,
      );
      this.scratchQuat.setFromEuler(this.scratchEuler);
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.weatherMesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.weatherMesh.instanceMatrix.needsUpdate = true;

    for (let i = 0; i < MIST_WISP_COUNT; i++) {
      const m = this.mistSeeds[i]!;
      const wx = wrapAroundFocus(
        m.offsetX + elapsed * m.driftX + this.driftX * 0.45,
        this.smoothFocusX,
        MIST_BOX_SPAN,
      );
      const wz = wrapAroundFocus(
        m.offsetZ + elapsed * m.driftZ + this.driftZ * 0.45,
        this.smoothFocusZ,
        MIST_BOX_SPAN,
      );
      const wy = m.baseY + Math.sin(elapsed * 0.45 + m.phase) * 0.25;
      const pulse = 0.92 + 0.12 * Math.sin(elapsed * 0.7 + m.phase);

      this.scratchPos.set(wx, wy, wz);
      this.scratchScale.set(
        m.radiusX * this.curMistScaleMult * pulse,
        0.28 * this.curMistScaleMult,
        m.radiusZ * this.curMistScaleMult * pulse,
      );
      this.scratchEuler.set(0, m.phase + elapsed * 0.04, 0);
      this.scratchQuat.setFromEuler(this.scratchEuler);
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.mistMesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.mistMesh.instanceMatrix.needsUpdate = true;
  }

  /** Dispose all geometries, materials and scene attachments. */
  dispose(): void {
    this.scene.remove(this.weatherMesh);
    this.scene.remove(this.mistMesh);
    this.weatherGeo.dispose();
    this.weatherMat.dispose();
    this.mistGeo.dispose();
    this.mistMat.dispose();
  }
}
