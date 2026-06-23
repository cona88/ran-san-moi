import { IcosahedronGeometry, Mesh, MeshStandardMaterial, PointLight, type Scene } from 'three';
import type { Cell } from '../core/types';
import { COLORS } from './palette';
import { cellToWorld } from './world';

/** The pulsing food orb and the point light that follows it. */
export class FoodView {
  private readonly mesh: Mesh<IcosahedronGeometry, MeshStandardMaterial>;
  private readonly light = new PointLight(COLORS.food, 1.2, 6);

  constructor(
    private readonly scene: Scene,
    private readonly half: number,
  ) {
    this.mesh = new Mesh(
      new IcosahedronGeometry(0.42, 0),
      new MeshStandardMaterial({
        color: COLORS.food,
        emissive: COLORS.food,
        emissiveIntensity: 1.8,
        metalness: 0.1,
        roughness: 0.2,
      }),
    );
    this.scene.add(this.mesh);
    this.scene.add(this.light);
  }

  /** Move the orb to a grid cell. */
  setCell(cell: Cell): void {
    const w = cellToWorld(cell.x, cell.z, this.half);
    this.mesh.position.set(w.x, 0, w.z);
    this.light.position.set(w.x, 0.6, w.z);
  }

  /** Spin, bob and pulse the orb. */
  animate(elapsed: number, delta: number): void {
    this.mesh.rotation.y += delta * 1.6;
    this.mesh.rotation.x += delta * 0.8;
    this.mesh.scale.setScalar(1 + Math.sin(elapsed * 4) * 0.12);
    this.mesh.position.y = 0.15 + Math.sin(elapsed * 3) * 0.12;
    this.light.intensity = 1.2 + Math.sin(elapsed * 4) * 0.4;
  }

  dispose(): void {
    this.scene.remove(this.mesh);
    this.scene.remove(this.light);
    this.mesh.geometry.dispose();
    this.mesh.material.dispose();
  }
}
