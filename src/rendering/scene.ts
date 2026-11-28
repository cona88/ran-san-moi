import {
  AmbientLight,
  Color,
  DirectionalLight,
  DynamicDrawUsage,
  Euler,
  Fog,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  NeutralToneMapping,
  OctahedronGeometry,
  PerspectiveCamera,
  PointLight,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import type { AdventureRegionId, VisualTheme } from '../core/types';
import { cameraFitDistance } from './cameraFit';
import { THEMES } from './palette';

const FOV = 50;
const FOG_NEAR = 125;
const FOG_FAR = 860;
const CAMERA_FAR = 1550;
const INTRO_ORBIT_RADIUS = 48;
const INTRO_ORBIT_ELEV_RAD = (15 * Math.PI) / 180;
const INTRO_ORBIT_SPEED = 0.11;
const INTRO_LOOK_Y = 14.5;
const PANORAMIC_VISTA_BLEND = 0.9;
const DEFAULT_ADVENTURE_VISTA = 0.12;
const MAX_LOOK_OFFSET = 4.2;
const AMBIENT_PARTICLE_COUNT = 84;
const SNAP_DISTANCE_SQ = 12 * 12;

interface AmbientMote {
  readonly baseAngle: number;
  readonly radius: number;
  readonly baseY: number;
  readonly speed: number;
  readonly bobSpeed: number;
  readonly phase: number;
  readonly scale: number;
  readonly spinSpeed: number;
}

interface ClimateLightingSpec {
  readonly dirTint: number;
  readonly dirIntensityMult: number;
  readonly hemiSky: number;
  readonly hemiGround: number;
  readonly hemiIntensity: number;
  readonly fogTint: number;
  readonly fogNearMult: number;
  readonly fogFarMult: number;
  readonly tintStrength: number;
}

const CLIMATE_LIGHTING: Readonly<Record<AdventureRegionId, ClimateLightingSpec>> = {
  royal_citadel: {
    dirTint: 0xffe49e,
    dirIntensityMult: 1.06,
    hemiSky: 0x9edbff,
    hemiGround: 0x82b868,
    hemiIntensity: 0.44,
    fogTint: 0xf7e6be,
    fogNearMult: 1.04,
    fogFarMult: 1.05,
    tintStrength: 0.46,
  },
  mushroom_woods: {
    dirTint: 0x9cf0c8,
    dirIntensityMult: 0.8,
    hemiSky: 0x5cc4a2,
    hemiGround: 0x2c6e49,
    hemiIntensity: 0.5,
    fogTint: 0x3b8a78,
    fogNearMult: 0.6,
    fogFarMult: 0.56,
    tintStrength: 0.62,
  },
  blossom_valley: {
    dirTint: 0xffd2e5,
    dirIntensityMult: 1.0,
    hemiSky: 0xffd8ec,
    hemiGround: 0x92cf7e,
    hemiIntensity: 0.48,
    fogTint: 0xf7cde0,
    fogNearMult: 0.94,
    fogFarMult: 0.92,
    tintStrength: 0.54,
  },
  crystal_sanctum: {
    dirTint: 0xcbeeff,
    dirIntensityMult: 1.1,
    hemiSky: 0xb8e6ff,
    hemiGround: 0xd8f3ff,
    hemiIntensity: 0.56,
    fogTint: 0xbce6fa,
    fogNearMult: 0.84,
    fogFarMult: 0.78,
    tintStrength: 0.6,
  },
  mermaid_lagoon: {
    dirTint: 0xd4f4ff,
    dirIntensityMult: 1.08,
    hemiSky: 0x7ae2ff,
    hemiGround: 0x32cbb8,
    hemiIntensity: 0.5,
    fogTint: 0x9ae8f5,
    fogNearMult: 1.0,
    fogFarMult: 0.98,
    tintStrength: 0.56,
  },
  candy_highlands: {
    dirTint: 0xffcc88,
    dirIntensityMult: 1.05,
    hemiSky: 0xffe2ad,
    hemiGround: 0xd49a6a,
    hemiIntensity: 0.46,
    fogTint: 0xf7cfa0,
    fogNearMult: 0.96,
    fogFarMult: 0.94,
    tintStrength: 0.56,
  },
  starlight_peaks: {
    dirTint: 0xbaa8ff,
    dirIntensityMult: 0.84,
    hemiSky: 0x7d74e8,
    hemiGround: 0x454e88,
    hemiIntensity: 0.48,
    fogTint: 0x4d4c8c,
    fogNearMult: 0.76,
    fogFarMult: 0.7,
    tintStrength: 0.62,
  },
};

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

/**
 * The renderer rig: WebGL renderer, scene graph, player-following adaptive
 * isometric camera with level-based zoom & smooth DualSense Right-Stick tilt,
 * theme-aware lighting & anti-glare bloom + OutputPass pipeline.
 */
export class SceneRig {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly viewport = { width: 0, height: 0 };
  private viewportDirty = true;

  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloomPass: UnrealBloomPass;
  private readonly outputPass: OutputPass;
  private readonly fog: Fog;

  private readonly ambientLight: AmbientLight;
  private readonly dirLight: DirectionalLight;
  private readonly hemiLight: HemisphereLight;
  private readonly fillLight: PointLight;
  private readonly accentLight: PointLight;

  private readonly ambientGeometry = new OctahedronGeometry(0.13, 0);
  private readonly ambientMaterial = new MeshBasicMaterial({
    color: 0xffffff,
    transparent: true,
    opacity: 0.72,
  });
  private readonly ambientMesh: InstancedMesh;
  private readonly motes: AmbientMote[] = [];
  private readonly scratchMatrix = new Matrix4();
  private readonly scratchPos = new Vector3();
  private readonly scratchScale = new Vector3();
  private readonly scratchEuler = new Euler();
  private readonly scratchQuat = new Quaternion();
  private readonly scratchColor = new Color();

  private readonly cameraDir = new Vector3(0, 17, 10.5);
  private readonly vistaDir = new Vector3(0, 5.0, 27.0).normalize();
  private readonly blendedDir = new Vector3();
  private readonly scratchFollowPos = new Vector3();
  private readonly scratchFollowLook = new Vector3();
  private readonly scratchOrbitPos = new Vector3();
  private readonly scratchOrbitLook = new Vector3();
  private readonly baseDistance: number;
  private fittedDistance = 20;

  private currentFollowX = 0;
  private currentFollowZ = 0;
  private hasSnappedFollow = false;

  private targetZoom = 1;
  private currentZoom = 1;
  private zoomPulse = 0;
  private aerialAltitude = 0;
  private extraZoomTarget = 0;
  private extraZoom = 0;
  private vistaTarget = DEFAULT_ADVENTURE_VISTA;
  private vistaBlend = DEFAULT_ADVENTURE_VISTA;
  private panoramicMode = false;
  private introOrbitActive = false;
  private introOrbitBlend = 0;
  private introOrbitAngle = -0.18;
  private hasSnappedIntro = false;

  private targetLookX = 0;
  private targetLookZ = 0;
  private currentLookX = 0;
  private currentLookZ = 0;

  private shakeIntensity = 0;
  private shakeDuration = 0;
  private shakeTimer = 0;
  private shakePhase = 0;
  private shakeOffsetX = 0;
  private shakeOffsetY = 0;
  private shakeOffsetZ = 0;

  private baseAmbientOpacity = 0.72;
  private baseFillIntensity = 0.28;
  private baseAccentIntensity = 0.24;

  private currentTheme: VisualTheme = 'honeycomb_arena';
  private targetClimateRegion: AdventureRegionId = 'royal_citadel';

  private readonly curDirColor = new Color();
  private readonly targetDirColor = new Color();
  private curDirIntensity = 0.92;
  private targetDirIntensity = 0.92;

  private readonly curHemiSky = new Color();
  private readonly targetHemiSky = new Color();
  private readonly curHemiGround = new Color();
  private readonly targetHemiGround = new Color();
  private curHemiIntensity = 0.44;
  private targetHemiIntensity = 0.44;

  private readonly curFogColor = new Color();
  private readonly targetFogColor = new Color();
  private readonly curBgColor = new Color();
  private readonly targetBgColor = new Color();
  private curFogNearMult = 1;
  private targetFogNearMult = 1;
  private curFogFarMult = 1;
  private targetFogFarMult = 1;
  private readonly scratchClimateColor = new Color();

  constructor(
    private readonly container: HTMLElement,
    private readonly viewHalfExtent = 11.5,
  ) {
    const w = Math.max(1, container.clientWidth || window.innerWidth || 800);
    const h = Math.max(1, container.clientHeight || window.innerHeight || 600);

    this.baseDistance = this.cameraDir.length();
    this.cameraDir.normalize();

    this.renderer = new WebGLRenderer({
      antialias: true,
      alpha: false,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = NeutralToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    container.appendChild(this.renderer.domElement);

    const palette = THEMES[this.currentTheme];
    this.scene.background = new Color(palette.background);
    this.fog = new Fog(palette.fogColor, FOG_NEAR, FOG_FAR);
    this.scene.fog = this.fog;

    this.camera = new PerspectiveCamera(FOV, w / h, 0.1, CAMERA_FAR);

    this.ambientLight = new AmbientLight(palette.ambientColor, palette.ambientIntensity);
    this.scene.add(this.ambientLight);

    this.dirLight = new DirectionalLight(palette.dirColor, palette.dirIntensity);
    this.dirLight.position.set(14, 26, 16);
    this.scene.add(this.dirLight);

    this.hemiLight = new HemisphereLight(0x9edbff, 0x82b868, 0.44);
    this.scene.add(this.hemiLight);

    this.fillLight = new PointLight(palette.fillColor, palette.fillIntensity, 64);
    this.fillLight.position.set(-10, 8, -9);
    this.scene.add(this.fillLight);

    this.accentLight = new PointLight(palette.accentColor, palette.accentIntensity, 64);
    this.accentLight.position.set(10, 7, 10);
    this.scene.add(this.accentLight);

    this.ambientMesh = new InstancedMesh(
      this.ambientGeometry,
      this.ambientMaterial,
      AMBIENT_PARTICLE_COUNT,
    );
    this.ambientMesh.instanceMatrix.setUsage(DynamicDrawUsage);
    this.ambientMesh.frustumCulled = false;
    this.initAmbientMotes();
    this.scene.add(this.ambientMesh);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloomPass = new UnrealBloomPass(new Vector2(w, h), 0.27, 0.38, 0.79);
    this.composer.addPass(this.bloomPass);
    this.outputPass = new OutputPass();
    this.composer.addPass(this.outputPass);

    this.setTheme(this.currentTheme);
    this.fitCamera();
  }

  /** Apply a visual theme to background, fog, lights, bloom thresholds and ambient motes. */
  setTheme(theme: VisualTheme): void {
    this.currentTheme = theme;
    const palette = THEMES[theme];

    this.ambientLight.color.setHex(palette.ambientColor);
    this.ambientLight.intensity = palette.ambientIntensity;
    this.fillLight.color.setHex(palette.fillColor);
    this.accentLight.color.setHex(palette.accentColor);

    this.recomputeClimateTargets();
    this.applyClimateImmediate();

    // Anti-glare bloom & fill/accent vibrancy tuning: keep warm/pastel arenas crisp while VFX glow.
    if (theme === 'honeycomb_arena') {
      this.bloomPass.threshold = 0.79;
      this.bloomPass.strength = 0.27;
      this.bloomPass.radius = 0.38;
      this.baseAmbientOpacity = 0.58;
      this.baseFillIntensity = palette.fillIntensity * 1.42;
      this.baseAccentIntensity = palette.accentIntensity * 1.48;
    } else if (theme === 'candy_island') {
      this.bloomPass.threshold = 0.78;
      this.bloomPass.strength = 0.29;
      this.bloomPass.radius = 0.4;
      this.baseAmbientOpacity = 0.78;
      this.baseFillIntensity = palette.fillIntensity * 1.28;
      this.baseAccentIntensity = palette.accentIntensity * 1.32;
    } else {
      this.bloomPass.threshold = 0.36;
      this.bloomPass.strength = 0.48;
      this.bloomPass.radius = 0.44;
      this.baseAmbientOpacity = 0.85;
      this.baseFillIntensity = palette.fillIntensity;
      this.baseAccentIntensity = palette.accentIntensity;
    }
    this.ambientMaterial.opacity = this.baseAmbientOpacity;
    this.fillLight.intensity = this.baseFillIntensity;
    this.accentLight.intensity = this.baseAccentIntensity;

    const paletteColors = palette.ambientColors;
    for (let i = 0; i < AMBIENT_PARTICLE_COUNT; i++) {
      const hex = paletteColors[i % paletteColors.length] ?? 0xffffff;
      this.scratchColor.setHex(hex);
      this.ambientMesh.setColorAt(i, this.scratchColor);
    }
    if (this.ambientMesh.instanceColor) {
      this.ambientMesh.instanceColor.needsUpdate = true;
    }
  }

  /** Trigger a smoothly damped camera impact shake (in world units). */
  triggerShake(intensity: number, durationSec = 0.26): void {
    if (!Number.isFinite(intensity) || !Number.isFinite(durationSec)) return;
    const safeIntensity = clamp(intensity, 0, 1.5);
    const safeDuration = clamp(durationSec, 0.05, 1.5);
    if (safeIntensity <= 0) return;

    const currentEnvelope =
      this.shakeTimer > 0 && this.shakeDuration > 0
        ? this.shakeIntensity * (this.shakeTimer / this.shakeDuration)
        : 0;
    this.shakeIntensity = Math.max(currentEnvelope, safeIntensity);
    this.shakeDuration = safeDuration;
    this.shakeTimer = safeDuration;
  }

  /** Trigger a smoothly damped zoom pulse (negative = punch in, positive = kick out). */
  triggerZoomPulse(amount: number): void {
    if (!Number.isFinite(amount)) return;
    this.zoomPulse = clamp(this.zoomPulse + amount, -0.16, 0.2);
  }

  /** Smoothly pull the camera back (e.g. `0.85` = 85% farther) for panoramic vistas & sightseeing tours. */
  setExtraZoom(amount: number): void {
    this.extraZoomTarget = Number.isFinite(amount) ? clamp(amount, 0, 1.15) : 0;
  }

  /** Smoothly tilt toward a panoramic horizon vista (`0..1`) around colossal landmarks & aerial flight. */
  setVistaBlend(amount: number): void {
    this.vistaTarget = Number.isFinite(amount) ? clamp(amount, 0, 1) : DEFAULT_ADVENTURE_VISTA;
  }

  /** Toggle cinematic panoramic horizon mode (`0.72` smooth horizon lock). */
  setPanoramicMode(enabled: boolean): void {
    this.panoramicMode = enabled;
  }

  /** Flip cinematic panoramic horizon mode and return the new state. */
  togglePanoramicMode(): boolean {
    this.panoramicMode = !this.panoramicMode;
    return this.panoramicMode;
  }

  /** Whether cinematic panoramic horizon mode is currently enabled. */
  isPanoramicMode(): boolean {
    return this.panoramicMode;
  }

  /** Enable or disable the title-screen panoramic intro orbit around Central Royal Castle. */
  setIntroOrbit(active: boolean): void {
    if (active && !this.introOrbitActive && !this.hasSnappedIntro) {
      this.introOrbitBlend = 1;
      this.hasSnappedIntro = true;
    }
    this.introOrbitActive = active;
  }

  /** Set normalized camera look offset (-1..1) from DualSense Right Stick. */
  setCameraLook(nx: number, ny: number): void {
    const safeX = Number.isFinite(nx) ? clamp(nx, -1, 1) : 0;
    const safeY = Number.isFinite(ny) ? clamp(ny, -1, 1) : 0;
    this.targetLookX = safeX * MAX_LOOK_OFFSET;
    this.targetLookZ = safeY * MAX_LOOK_OFFSET;
  }

  /** Snap the camera immediately to a world position (e.g. initial spawn, wrap, reset). */
  snapFollowTarget(x: number, z: number, playerLevel = 5): void {
    this.currentFollowX = x;
    this.currentFollowZ = z;
    this.hasSnappedFollow = true;
    this.targetZoom = this.computeZoomScale(playerLevel);
    this.currentZoom = this.targetZoom;
    this.zoomPulse = 0;
    this.aerialAltitude = 0;
    const baseVista = this.panoramicMode ? PANORAMIC_VISTA_BLEND : DEFAULT_ADVENTURE_VISTA;
    this.vistaTarget = baseVista;
    this.vistaBlend = baseVista;
    this.introOrbitBlend = this.introOrbitActive ? 1 : 0;
    this.shakeTimer = 0;
    this.shakeOffsetX = 0;
    this.shakeOffsetY = 0;
    this.shakeOffsetZ = 0;
    this.applyCameraTransform();
  }

  /** Update smooth player-following camera, level zoom, look tilt, shake & ambient motes. */
  update(
    elapsed: number,
    delta: number,
    followX = 0,
    followZ = 0,
    playerLevel = 5,
    aerialAltitude = 0,
  ): void {
    const dt = Math.min(Math.max(delta, 0), 0.1);
    const lookSmooth = 1 - Math.exp(-9 * dt);
    this.currentLookX += (this.targetLookX - this.currentLookX) * lookSmooth;
    this.currentLookZ += (this.targetLookZ - this.currentLookZ) * lookSmooth;

    const dx = followX - this.currentFollowX;
    const dz = followZ - this.currentFollowZ;
    if (!this.hasSnappedFollow || dx * dx + dz * dz > SNAP_DISTANCE_SQ) {
      this.currentFollowX = followX;
      this.currentFollowZ = followZ;
      this.hasSnappedFollow = true;
    } else {
      const followSmooth = 1 - Math.exp(-14 * dt);
      this.currentFollowX += dx * followSmooth;
      this.currentFollowZ += dz * followSmooth;
    }

    this.aerialAltitude = Math.max(0, aerialAltitude);
    this.targetZoom = this.computeZoomScale(playerLevel);
    const zoomSmooth = 1 - Math.exp(-5 * dt);
    this.currentZoom += (this.targetZoom - this.currentZoom) * zoomSmooth;
    this.extraZoom += (this.extraZoomTarget - this.extraZoom) * (1 - Math.exp(-3.2 * dt));
    const effectiveVistaTarget = this.panoramicMode ? PANORAMIC_VISTA_BLEND : this.vistaTarget;
    this.vistaBlend += (effectiveVistaTarget - this.vistaBlend) * (1 - Math.exp(-3.2 * dt));

    if (this.introOrbitActive) {
      this.introOrbitAngle += INTRO_ORBIT_SPEED * dt;
    }
    const introTarget = this.introOrbitActive ? 1 : 0;
    const introRate = this.introOrbitActive ? 3.2 : 2.6;
    this.introOrbitBlend += (introTarget - this.introOrbitBlend) * (1 - Math.exp(-introRate * dt));
    if (!this.introOrbitActive && this.introOrbitBlend < 1e-4) {
      this.introOrbitBlend = 0;
    } else if (this.introOrbitActive && this.introOrbitBlend > 0.9999) {
      this.introOrbitBlend = 1;
    }

    if (this.zoomPulse !== 0) {
      this.zoomPulse *= Math.exp(-9 * dt);
      if (Math.abs(this.zoomPulse) < 1e-4) this.zoomPulse = 0;
    }

    if (this.shakeTimer > 0) {
      this.shakeTimer = Math.max(0, this.shakeTimer - dt);
      const ratio = this.shakeDuration > 0 ? this.shakeTimer / this.shakeDuration : 0;
      const amp = this.shakeIntensity * ratio * ratio;
      this.shakePhase += dt * 46;
      this.shakeOffsetX =
        (Math.sin(this.shakePhase * 1.13) * 0.65 + Math.cos(this.shakePhase * 2.37) * 0.35) * amp;
      this.shakeOffsetY =
        (Math.cos(this.shakePhase * 1.57) * 0.6 + Math.sin(this.shakePhase * 2.71) * 0.4) *
        amp *
        0.65;
      this.shakeOffsetZ =
        (Math.sin(this.shakePhase * 1.89 + 1.1) * 0.65 + Math.cos(this.shakePhase * 2.93) * 0.35) *
        amp;
    } else if (this.shakeOffsetX !== 0 || this.shakeOffsetY !== 0 || this.shakeOffsetZ !== 0) {
      const settle = Math.exp(-26 * dt);
      this.shakeOffsetX *= settle;
      this.shakeOffsetY *= settle;
      this.shakeOffsetZ *= settle;
      if (
        Math.abs(this.shakeOffsetX) < 1e-4 &&
        Math.abs(this.shakeOffsetY) < 1e-4 &&
        Math.abs(this.shakeOffsetZ) < 1e-4
      ) {
        this.shakeOffsetX = 0;
        this.shakeOffsetY = 0;
        this.shakeOffsetZ = 0;
      }
    }

    this.fillLight.intensity = this.baseFillIntensity * (1 + 0.06 * Math.sin(elapsed * 1.6));
    this.accentLight.intensity =
      this.baseAccentIntensity * (1 + 0.07 * Math.cos(elapsed * 1.9 + 0.8));

    this.updateClimateLighting(dt);
    this.applyCameraTransform();
    this.updateAmbientMotes(elapsed);
  }

  /** Set target kingdom climate region for smooth directional/hemisphere/fog blending. */
  setClimateRegion(regionId: AdventureRegionId): void {
    if (this.targetClimateRegion === regionId) return;
    this.targetClimateRegion = regionId;
    this.recomputeClimateTargets();
  }

  /** Render one frame through the bloom composer. */
  render(): void {
    this.composer.render();
  }

  /** Effective viewport dimensions for 2D UI projection. */
  getViewportSize(): { width: number; height: number } {
    // Cached: reading clientWidth/clientHeight every call forces a synchronous layout
    // whenever the DOM HUD is dirty (this runs per frame for survival arrows).
    if (this.viewportDirty) {
      this.viewport.width = this.container.clientWidth || window.innerWidth;
      this.viewport.height = this.container.clientHeight || window.innerHeight;
      this.viewportDirty = false;
    }
    return this.viewport;
  }

  /** Current world-space focus point `(followX, followZ)`. */
  getFollowTarget(target = new Vector3()): Vector3 {
    return target.set(this.currentFollowX, 0, this.currentFollowZ);
  }

  /** Current smooth zoom scale (`1.0 .. 1.55`). */
  getZoomScale(): number {
    return this.currentZoom;
  }

  /** Match renderer, composer and camera to the current window size. */
  resize(): void {
    this.viewportDirty = true;
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.bloomPass.resolution.set(w, h);
    this.fitCamera();
  }

  dispose(): void {
    this.scene.remove(this.ambientMesh);
    this.scene.remove(this.ambientLight);
    this.scene.remove(this.dirLight);
    this.scene.remove(this.hemiLight);
    this.scene.remove(this.fillLight);
    this.scene.remove(this.accentLight);
    this.ambientLight.dispose();
    this.dirLight.dispose();
    this.hemiLight.dispose();
    this.fillLight.dispose();
    this.accentLight.dispose();
    this.ambientGeometry.dispose();
    this.ambientMaterial.dispose();
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }

  private recomputeClimateTargets(): void {
    const palette = THEMES[this.currentTheme];
    const spec = CLIMATE_LIGHTING[this.targetClimateRegion];
    const isDarkTheme =
      this.currentTheme === 'crystal_garden' || this.currentTheme === 'starlight_galaxy';
    const isPastelTheme = this.currentTheme === 'candy_island';

    const dirMix = isDarkTheme ? spec.tintStrength * 0.55 : spec.tintStrength * 0.82;
    const fogMix = isDarkTheme
      ? spec.tintStrength * 0.34
      : isPastelTheme
        ? spec.tintStrength * 0.65
        : spec.tintStrength * 0.86;
    const hemiMix = isDarkTheme ? 0.55 : 0.28;
    const hemiScale = isDarkTheme ? 0.72 : 1.0;

    this.targetDirColor
      .setHex(palette.dirColor)
      .lerp(this.scratchClimateColor.setHex(spec.dirTint), dirMix);
    this.targetDirIntensity = palette.dirIntensity * spec.dirIntensityMult;

    this.targetHemiSky
      .setHex(spec.hemiSky)
      .lerp(this.scratchClimateColor.setHex(palette.ambientColor), hemiMix);
    this.targetHemiGround
      .setHex(spec.hemiGround)
      .lerp(this.scratchClimateColor.setHex(palette.floorBase), hemiMix);
    this.targetHemiIntensity = spec.hemiIntensity * hemiScale;

    this.targetFogColor
      .setHex(palette.fogColor)
      .lerp(this.scratchClimateColor.setHex(spec.fogTint), fogMix);
    this.targetBgColor
      .setHex(palette.background)
      .lerp(this.scratchClimateColor.setHex(spec.fogTint), fogMix);
    this.targetFogNearMult = spec.fogNearMult;
    this.targetFogFarMult = spec.fogFarMult;
  }

  private applyClimateImmediate(): void {
    this.curDirColor.copy(this.targetDirColor);
    this.curDirIntensity = this.targetDirIntensity;
    this.curHemiSky.copy(this.targetHemiSky);
    this.curHemiGround.copy(this.targetHemiGround);
    this.curHemiIntensity = this.targetHemiIntensity;
    this.curFogColor.copy(this.targetFogColor);
    this.curBgColor.copy(this.targetBgColor);
    this.curFogNearMult = this.targetFogNearMult;
    this.curFogFarMult = this.targetFogFarMult;
    this.syncClimateObjects();
  }

  private updateClimateLighting(dt: number): void {
    const smooth = 1 - Math.exp(-1.8 * dt);
    this.curDirColor.lerp(this.targetDirColor, smooth);
    this.curDirIntensity += (this.targetDirIntensity - this.curDirIntensity) * smooth;
    this.curHemiSky.lerp(this.targetHemiSky, smooth);
    this.curHemiGround.lerp(this.targetHemiGround, smooth);
    this.curHemiIntensity += (this.targetHemiIntensity - this.curHemiIntensity) * smooth;
    this.curFogColor.lerp(this.targetFogColor, smooth);
    this.curBgColor.lerp(this.targetBgColor, smooth);
    this.curFogNearMult += (this.targetFogNearMult - this.curFogNearMult) * smooth;
    this.curFogFarMult += (this.targetFogFarMult - this.curFogFarMult) * smooth;
    this.syncClimateObjects();
  }

  private syncClimateObjects(): void {
    this.dirLight.color.copy(this.curDirColor);
    this.dirLight.intensity = this.curDirIntensity;
    this.hemiLight.color.copy(this.curHemiSky);
    this.hemiLight.groundColor.copy(this.curHemiGround);
    this.hemiLight.intensity = this.curHemiIntensity;
    this.fog.color.copy(this.curFogColor);
    (this.scene.background as Color).copy(this.curBgColor);
  }

  private computeZoomScale(level: number): number {
    return clamp(1 + Math.sqrt(Math.max(0, level - 5)) * 0.045, 1, 1.55);
  }

  private initAmbientMotes(): void {
    for (let i = 0; i < AMBIENT_PARTICLE_COUNT; i++) {
      const frac = (i + 0.5) / AMBIENT_PARTICLE_COUNT;
      const baseAngle = i * 2.3999632;
      const radius = 8 + frac * 18;
      const baseY = -0.2 + ((i * 7) % 11) * 0.55;
      this.motes.push({
        baseAngle,
        radius,
        baseY,
        speed: 0.05 + (i % 5) * 0.018,
        bobSpeed: 0.9 + (i % 4) * 0.35,
        phase: i * 0.73,
        scale: 0.55 + (i % 5) * 0.16,
        spinSpeed: 0.7 + (i % 3) * 0.5,
      });
      this.scratchColor.setHex(0xffffff);
      this.ambientMesh.setColorAt(i, this.scratchColor);
    }
    if (this.ambientMesh.instanceColor) {
      this.ambientMesh.instanceColor.needsUpdate = true;
    }
  }

  private updateAmbientMotes(elapsed: number): void {
    const style = THEMES[this.currentTheme].particleStyle;
    this.ambientMesh.position.set(this.currentFollowX, 0, this.currentFollowZ);
    this.ambientMaterial.opacity =
      this.baseAmbientOpacity * (0.86 + 0.14 * Math.sin(elapsed * 2.2));

    for (let i = 0; i < AMBIENT_PARTICLE_COUNT; i++) {
      const m = this.motes[i];
      if (!m) continue;

      let angle = m.baseAngle + elapsed * m.speed;
      let y = m.baseY + Math.sin(elapsed * m.bobSpeed + m.phase) * 0.85;
      let r = m.radius * this.currentZoom;
      let s = m.scale;

      const shimmer =
        0.78 + 0.34 * (0.5 + 0.5 * Math.sin(elapsed * (3.2 + (i % 5) * 0.65) + m.phase * 1.9));

      if (style === 'stars') {
        angle = m.baseAngle + elapsed * 0.012;
        y = 1.2 + ((i * 11) % 14) * 0.55;
        r = (11 + (i % 12) * 1.4) * this.currentZoom;
        s = m.scale * (0.55 + 0.55 * (0.5 + 0.5 * Math.sin(elapsed * 2.6 + m.phase))) * shimmer;
      } else if (style === 'bubbles') {
        const rise = ((elapsed * 0.55 + m.phase) % 7) - 0.3;
        y = rise;
        r = m.radius * this.currentZoom + Math.sin(elapsed * 0.8 + m.phase) * 0.6;
        s = m.scale * (0.88 + 0.24 * Math.sin(elapsed * 2.4 + m.phase)) * shimmer;
      } else if (style === 'pollen') {
        angle = m.baseAngle + elapsed * m.speed * 0.65;
        y = 0.6 + ((i * 5) % 9) * 0.48 + Math.sin(elapsed * 1.6 + m.phase) * 0.45;
        s = m.scale * 0.86 * (0.76 + 0.36 * Math.sin(elapsed * 2.5 + m.phase)) * shimmer;
      } else {
        s = m.scale * (0.72 + 0.4 * (0.5 + 0.5 * Math.sin(elapsed * 3.1 + m.phase))) * shimmer;
      }

      this.scratchPos.set(Math.cos(angle) * r, y, Math.sin(angle) * r);
      this.scratchScale.set(s, s, s);
      this.scratchEuler.set(
        elapsed * m.spinSpeed * 0.55 + m.phase,
        elapsed * m.spinSpeed + m.phase,
        0,
      );
      this.scratchQuat.setFromEuler(this.scratchEuler);
      this.scratchMatrix.compose(this.scratchPos, this.scratchQuat, this.scratchScale);
      this.ambientMesh.setMatrixAt(i, this.scratchMatrix);
    }
    this.ambientMesh.instanceMatrix.needsUpdate = true;
  }

  private fitCamera(): void {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    if (w <= 0 || h <= 0) return;
    const distance = cameraFitDistance(w / h, this.baseDistance, this.viewHalfExtent, FOV);
    if (!Number.isFinite(distance)) return;

    this.fittedDistance = distance;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.applyCameraTransform();
  }

  private applyCameraTransform(): void {
    const effectiveZoom = Math.max(0.78, this.currentZoom * (1 + this.extraZoom) + this.zoomPulse);
    const dist = this.fittedDistance * effectiveZoom;
    const scale = dist / this.baseDistance;
    this.fog.near = FOG_NEAR * scale * this.curFogNearMult;
    this.fog.far = FOG_FAR * scale * this.curFogFarMult;

    const vBlend = this.vistaBlend;
    this.blendedDir.copy(this.cameraDir);
    if (vBlend > 1e-4) {
      this.blendedDir.lerp(this.vistaDir, vBlend).normalize();
    }

    const lookX = this.currentFollowX + this.currentLookX + this.shakeOffsetX * 0.45;
    const lookY =
      (this.aerialAltitude > 0.005 ? this.aerialAltitude * 0.55 : 0) +
      vBlend * 14.5 +
      this.shakeOffsetY * 0.35;
    const lookZ =
      this.currentFollowZ + this.currentLookZ - vBlend * 22.0 + this.shakeOffsetZ * 0.45;

    const aerialY = this.aerialAltitude > 0.005 ? this.aerialAltitude * 1.5 : 0;
    const aerialZ = this.aerialAltitude > 0.005 ? this.aerialAltitude * 1.2 : 0;

    this.scratchFollowPos.set(
      this.currentFollowX + this.blendedDir.x * dist + this.currentLookX * 0.45 + this.shakeOffsetX,
      this.blendedDir.y * dist - this.currentLookZ * 0.2 + aerialY + this.shakeOffsetY,
      this.currentFollowZ +
        this.blendedDir.z * dist +
        this.currentLookZ * 0.3 +
        aerialZ +
        this.shakeOffsetZ,
    );
    this.scratchFollowLook.set(lookX, lookY, lookZ);

    if (this.introOrbitBlend > 1e-4) {
      const horizR = INTRO_ORBIT_RADIUS * Math.cos(INTRO_ORBIT_ELEV_RAD);
      const orbitY = INTRO_ORBIT_RADIUS * Math.sin(INTRO_ORBIT_ELEV_RAD);
      this.scratchOrbitPos.set(
        Math.sin(this.introOrbitAngle) * horizR,
        orbitY,
        Math.cos(this.introOrbitAngle) * horizR,
      );
      this.scratchOrbitLook.set(0, INTRO_LOOK_Y, 0);
      const b = this.introOrbitBlend;
      const smooth = b * b * (3 - 2 * b);
      this.scratchFollowPos.lerp(this.scratchOrbitPos, smooth);
      this.scratchFollowLook.lerp(this.scratchOrbitLook, smooth);
    }

    this.camera.position.copy(this.scratchFollowPos);
    this.camera.lookAt(this.scratchFollowLook);
    this.camera.updateMatrixWorld();

    this.fillLight.position.set(this.currentFollowX - 10, 8, this.currentFollowZ - 9);
    this.accentLight.position.set(this.currentFollowX + 10, 7, this.currentFollowZ + 10);
  }
}
