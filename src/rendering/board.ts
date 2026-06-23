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
  }

  /** Tint the whole frame (used to flash on game over). */
  setFrameColor(hex: number): void {
    this.frame?.material.color.set(new Color(hex));
  }

  dispose(): void {
    this.disposeMeshes();
  }

  private disposeMeshes(): void {
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
