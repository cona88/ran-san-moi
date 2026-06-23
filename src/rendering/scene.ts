import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  PerspectiveCamera,
  PointLight,
  Scene,
  Vector2,
  WebGLRenderer,
} from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { COLORS } from './palette';

/**
 * The renderer rig: WebGL renderer, scene graph, fixed isometric camera,
 * lights and the synthwave bloom post-processing pipeline. Owns the canvas
 * and all resize bookkeeping.
 */
export class SceneRig {
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private readonly renderer: WebGLRenderer;
  private readonly composer: EffectComposer;
  private readonly bloom: UnrealBloomPass;

  constructor(container: HTMLElement) {
    const { innerWidth: w, innerHeight: h } = window;

    this.renderer = new WebGLRenderer({ antialias: true, alpha: false });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(w, h);
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(COLORS.background);
    this.scene.fog = new Fog(COLORS.background, 18, 42);

    this.camera = new PerspectiveCamera(50, w / h, 0.1, 100);
    this.camera.position.set(0, 16, 15);
    this.camera.lookAt(0, 0, 0);

    this.scene.add(new AmbientLight(0x4422aa, 0.6));
    const dir = new DirectionalLight(0xffffff, 0.5);
    dir.position.set(6, 14, 8);
    this.scene.add(dir);
    const fill = new PointLight(COLORS.magenta, 0.6, 40);
    fill.position.set(-8, 6, -8);
    this.scene.add(fill);

    this.composer = new EffectComposer(this.renderer);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.bloom = new UnrealBloomPass(new Vector2(w, h), 0.9, 0.6, 0.15);
    this.composer.addPass(this.bloom);
  }

  /** Render one frame through the bloom composer. */
  render(): void {
    this.composer.render();
  }

  /** Match renderer, composer and camera to the current window size. */
  resize(): void {
    const { innerWidth: w, innerHeight: h } = window;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(w, h);
    this.composer.setSize(w, h);
  }

  dispose(): void {
    this.composer.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
