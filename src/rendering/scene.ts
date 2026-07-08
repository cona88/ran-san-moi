import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { COLORS } from './palette';
import { cameraFitDistance, cameraTargetZ } from './cameraFit';

const FOV = 50;
const FOG_NEAR = 18;
const FOG_FAR = 42;

/**
 * The renderer rig: WebGL renderer, scene graph, adaptive isometric camera,
 * lights and the synthwave bloom post-processing pipeline. Owns the canvas
 * and all resize bookkeeping.
 *
 * The camera keeps a fixed viewing direction but adapts its distance to the
 * viewport aspect ratio so the whole board stays visible on any screen
 * (portrait phones dolly back); the fog and far plane scale with it.
 */
export class SceneRig {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly fog: Fog;
  private readonly cameraDir = new Vector3(0, 16, 15);
  private readonly baseDistance: number;

  constructor(
    container: HTMLElement,
    private readonly fitHalfExtent: number,
  ) {
    const { innerWidth: w, innerHeight: h } = window;

    this.baseDistance = this.cameraDir.length();
    this.cameraDir.normalize();

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(COLORS.background);
    this.fog = new Fog(COLORS.background, FOG_NEAR, FOG_FAR);
    this.scene.fog = this.fog;

    // Generous far plane so dollying back on tall screens never clips the board.
    this.camera = new PerspectiveCamera(FOV, w / h, 0.1, 200);

    this.scene.add(new AmbientLight(0x4422aa, 0.6));
    const dir = new DirectionalLight(0xffffff, 0.5);
    dir.position.set(6, 14, 8);
    this.scene.add(dir);
    const fill = new PointLight(COLORS.magenta, 0.6, 40);
    fill.position.set(-8, 6, -8);
    this.scene.add(fill);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.composer.addPass(new UnrealBloomPass(new Vector2(w, h), 0.55, 0.5, 0.25));

    this.fitCamera();
  }

  /** Render one frame through the bloom composer. */
  render(): void {
    this.composer.render();
  }

  /** Match renderer, composer and camera to the current window size. */
  resize(): void {
    const { innerWidth: w, innerHeight: h } = window;
    if (w <= 0 || h <= 0) return; // minimized / hidden tab — keep last good frame
    // Re-apply pixel ratio: it can change at runtime (monitor swap, browser zoom).
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
    this.fitCamera();
  }

  /** Position the camera (and scale the fog) to frame the board for the aspect. */
  private fitCamera(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    if (w <= 0 || h <= 0) return; // degenerate viewport — don't poison the camera
    const distance = cameraFitDistance(w / h, this.baseDistance, this.fitHalfExtent, FOV);
    if (!Number.isFinite(distance)) return;

    const aspect = w / h;
    this.camera.position.copy(this.cameraDir).multiplyScalar(distance);
    // Aim past the origin so the near and far board edges are vertically
    // balanced in the frame — looking dead at the centre crops the bottom row.
    const targetZ = cameraTargetZ(distance, this.fitHalfExtent, this.cameraDir.y, this.cameraDir.z);
    this.camera.lookAt(0, 0, targetZ);
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();

    const scale = distance / this.baseDistance;
    this.fog.near = FOG_NEAR * scale;
    this.fog.far = FOG_FAR * scale;
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
