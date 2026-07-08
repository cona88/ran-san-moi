import {
  BoxGeometry,
  Color,
  EdgesGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshStandardMaterial,
  PlaneGeometry,
} from 'three';
import { COLORS } from './palette';

/**
 * The arena floor, grid and neon frame. Rebuilt at the current active size
 * whenever the walls close in; everything stays centred on the origin.
 */
export class Board {
  readonly group = new Group();
  private floor?: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private grid?: GridHelper;
  private frame?: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private previewFrame?: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private previewSize = -1;

  /** Dispose the previous arena meshes and build fresh ones at `size`×`size`. */
  rebuild(size: number): void {
    this.disposeMeshes();

    this.floor = new Mesh(
      new PlaneGeometry(size, size),
      new MeshStandardMaterial({ color: 0x0d0420, metalness: 0.4, roughness: 0.7 }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.5;
    this.group.add(this.floor);

    this.grid = new GridHelper(size, size, COLORS.cyan, COLORS.purple);
    const gridMat = this.grid.material as LineBasicMaterial;
    gridMat.transparent = true;
    gridMat.opacity = 0.35;
    this.grid.position.y = -0.49;
    this.group.add(this.grid);

    this.frame = new LineSegments(
      new EdgesGeometry(new BoxGeometry(size, 1, size)),
      new LineBasicMaterial({ color: COLORS.magenta }),
    );
    this.group.add(this.frame);
  }

  /** Slowly cycle the frame hue for a living-neon feel. */
  animate(elapsed: number): void {
    this.frame?.material.color.setHSL((elapsed * 0.05) % 1, 1, 0.6);
    if (this.previewFrame) {
      // Urgent-but-never-invisible pulse warning that the walls will close here.
      this.previewFrame.material.opacity = 0.2 + 0.7 * (0.5 + 0.5 * Math.sin(elapsed * 8));
    }
  }

  /** Show a pulsing preview of the walls at their future (smaller) size. */
  showShrinkPreview(size: number): void {
    if (this.previewFrame && this.previewSize === size) return;
    this.hideShrinkPreview();
    this.previewFrame = new LineSegments(
      new EdgesGeometry(new BoxGeometry(size, 1, size)),
      new LineBasicMaterial({ color: COLORS.magenta, transparent: true, opacity: 0 }),
    );
    this.previewSize = size;
    this.group.add(this.previewFrame);
  }

  /** Remove the shrink-warning preview, if any. */
  hideShrinkPreview(): void {
    if (!this.previewFrame) return;
    this.group.remove(this.previewFrame);
    this.previewFrame.geometry.dispose();
    this.previewFrame.material.dispose();
    this.previewFrame = undefined;
    this.previewSize = -1;
  }

  /** Tint the whole frame (used to flash on game over). */
  setFrameColor(hex: number): void {
    this.frame?.material.color.set(new Color(hex));
  }

  dispose(): void {
    this.disposeMeshes();
  }

  private disposeMeshes(): void {
    this.hideShrinkPreview();
    for (const obj of [this.floor, this.grid, this.frame]) {
      if (!obj) continue;
      this.group.remove(obj);
      obj.geometry.dispose();
      const material = obj.material;
      if (Array.isArray(material)) {
        material.forEach((m) => m.dispose());
      } else {
        material.dispose();
      }
    }
    this.floor = undefined;
    this.grid = undefined;
    this.frame = undefined;
  }
}
