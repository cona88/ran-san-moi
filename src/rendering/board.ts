import {
  BoxGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  EdgesGeometry,
  GridHelper,
  Group,
  LineBasicMaterial,
  LineSegments,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  OctahedronGeometry,
  PlaneGeometry,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { VisualTheme } from '../core/types';
import { THEMES, type ThemePalette } from './palette';

interface DisposableObj {
  geometry: { dispose(): void };
  material: { dispose(): void } | { dispose(): void }[];
}

/**
 * The open-world arena floor (including the seamless hexagonal honeycomb floor
 * for `honeycomb_arena`), border crystal barriers (or rainbow portal curtains
 * in Cozy `wrapWalls` mode), and corner/edge beacon pillars.
 */
export class Board {
  readonly group = new Group();

  private floor?: Mesh<PlaneGeometry, MeshStandardMaterial>;
  private floorTexture?: CanvasTexture;
  private grid?: GridHelper;
  private frame?: LineSegments<EdgesGeometry, LineBasicMaterial>;
  private previewFrame?: LineSegments<EdgesGeometry, LineBasicMaterial>;

  private wallMeshes: Mesh[] = [];
  private portalTexture?: CanvasTexture;
  private portalMaterials: MeshBasicMaterial[] = [];
  private railMaterials: MeshStandardMaterial[] = [];

  private currentSize = -1;
  private currentWrapWalls = false;
  private currentTheme: VisualTheme = 'honeycomb_arena';
  private previewSize = -1;
  private gameOver = false;

  private readonly colorA = new Color();
  private readonly colorB = new Color();

  /** Rebuild arena geometry & theme visuals at `size`×`size` (`2 * worldRadius`). */
  rebuild(size: number, wrapWalls: boolean, theme: VisualTheme): void {
    this.currentSize = size;
    this.currentWrapWalls = wrapWalls;
    this.currentTheme = theme;
    this.disposeMeshes();

    const palette = THEMES[theme];
    const isHoneycomb = theme === 'honeycomb_arena';
    const floorSpan = isHoneycomb ? Math.max(size + 6, 118) : size + 4;

    this.floorTexture = isHoneycomb
      ? this.createHoneycombTexture(floorSpan, palette)
      : this.createTileTexture(size, palette);

    this.floor = new Mesh(
      new PlaneGeometry(floorSpan, floorSpan),
      new MeshStandardMaterial({
        color: isHoneycomb ? 0xffffff : palette.floorBase,
        map: this.floorTexture,
        metalness: isHoneycomb ? 0.04 : 0.16,
        roughness: isHoneycomb ? 0.86 : 0.56,
      }),
    );
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.5;
    this.group.add(this.floor);

    if (palette.gridOpacity > 0) {
      const divisions = Math.max(12, Math.min(Math.round(size / 2), 280));
      this.grid = new GridHelper(size, divisions, palette.gridCenter, palette.gridLine);
      const gridMat = this.grid.material as LineBasicMaterial;
      gridMat.transparent = true;
      gridMat.opacity = palette.gridOpacity;
      this.grid.position.y = -0.49;
      this.group.add(this.grid);
    }

    if (wrapWalls) {
      this.buildCozyRainbowPortals(size, palette);
    } else {
      this.buildSolidCrystalWalls(size, palette);
    }

    this.frame = new LineSegments(
      new EdgesGeometry(new BoxGeometry(size, wrapWalls ? 0.85 : 0.92, size)),
      new LineBasicMaterial({
        color: palette.framePrimary,
        transparent: true,
        opacity: wrapWalls ? 0.55 : 0.82,
      }),
    );
    this.frame.position.y = wrapWalls ? -0.08 : -0.04;
    this.group.add(this.frame);
  }

  /** Switch visual theme and rebuild the board cleanly if already sized. */
  setTheme(theme: VisualTheme): void {
    if (theme === this.currentTheme && this.currentSize > 0) return;
    this.currentTheme = theme;
    if (this.currentSize > 0) {
      const prevPreview = this.previewSize;
      this.rebuild(this.currentSize, this.currentWrapWalls, theme);
      if (prevPreview > 0) this.showShrinkPreview(prevPreview);
      if (this.gameOver) this.setGameOver(true);
    }
  }

  /** Set whether the arena shows the game-over tint. */
  setGameOver(isGameOver: boolean): void {
    this.gameOver = isGameOver;
    if (isGameOver) {
      const palette = THEMES[this.currentTheme];
      this.frame?.material.color.setHex(palette.frameGameOver);
      for (const mat of this.railMaterials) {
        mat.color.setHex(palette.frameGameOver);
        mat.emissive.setHex(palette.frameGameOver);
      }
    }
  }

  /** Slowly pulse frame rails or flow rainbow portal curtains at 60fps. */
  animate(elapsed: number): void {
    const palette = THEMES[this.currentTheme];

    if (!this.gameOver && this.frame) {
      if (this.currentWrapWalls) {
        this.frame.material.color.setHSL((elapsed * 0.12) % 1, 0.85, 0.74);
      } else {
        const blend = 0.5 + 0.5 * Math.sin(elapsed * 1.4);
        this.colorA.setHex(palette.framePrimary);
        this.colorB.setHex(palette.frameSecondary);
        this.frame.material.color.copy(this.colorA).lerp(this.colorB, blend);
      }
    }

    if (this.portalTexture) {
      this.portalTexture.offset.x = (elapsed * 0.16) % 1;
      const shimmer = 0.5 + 0.16 * Math.sin(elapsed * 2.8);
      for (const mat of this.portalMaterials) {
        mat.opacity = shimmer;
      }
    }

    if (!this.gameOver && this.railMaterials.length > 0) {
      const blend = 0.5 + 0.5 * Math.sin(elapsed * 1.4);
      this.colorA.setHex(palette.framePrimary);
      this.colorB.setHex(palette.frameSecondary);
      this.colorA.lerp(this.colorB, blend);
      const baseIntensity = this.currentTheme === 'honeycomb_arena' ? 0.35 : 0.55;
      for (const mat of this.railMaterials) {
        mat.emissive.copy(this.colorA);
        mat.emissiveIntensity = baseIntensity + 0.15 * Math.sin(elapsed * 2.5);
      }
    }

    if (this.previewFrame) {
      this.previewFrame.material.opacity = 0.25 + 0.65 * (0.5 + 0.5 * Math.sin(elapsed * 8));
    }
  }

  /** Show a pulsing preview of the walls at their future (smaller) size. */
  showShrinkPreview(size: number): void {
    if (this.previewFrame && this.previewSize === size) return;
    this.hideShrinkPreview();
    this.previewFrame = new LineSegments(
      new EdgesGeometry(new BoxGeometry(size, 0.9, size)),
      new LineBasicMaterial({ color: 0xff85c8, transparent: true, opacity: 0 }),
    );
    this.previewFrame.position.y = -0.05;
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

  dispose(): void {
    this.disposeMeshes();
  }

  private buildSolidCrystalWalls(size: number, palette: ThemePalette): void {
    const half = size / 2;
    const thickness = 0.42;
    const height = 0.68;
    const isWarm = palette.id === 'honeycomb_arena';

    const railMat = new MeshStandardMaterial({
      color: palette.framePrimary,
      emissive: palette.framePrimary,
      emissiveIntensity: isWarm ? 0.35 : 0.6,
      metalness: 0.22,
      roughness: 0.3,
      transparent: true,
      opacity: 0.88,
    });
    this.railMaterials.push(railMat);

    const railSpecs: readonly { w: number; d: number; x: number; z: number }[] = [
      { w: size + thickness * 2, d: thickness, x: 0, z: -half - thickness / 2 },
      { w: size + thickness * 2, d: thickness, x: 0, z: half + thickness / 2 },
      { w: thickness, d: size + thickness * 2, x: -half - thickness / 2, z: 0 },
      { w: thickness, d: size + thickness * 2, x: half + thickness / 2, z: 0 },
    ];

    for (const spec of railSpecs) {
      const rail = new Mesh(new BoxGeometry(spec.w, height, spec.d), railMat);
      rail.position.set(spec.x, -0.5 + height / 2, spec.z);
      this.group.add(rail);
      this.wallMeshes.push(rail);
    }

    const pillarMat = new MeshStandardMaterial({
      color: palette.pillarColor,
      emissive: palette.frameSecondary,
      emissiveIntensity: isWarm ? 0.38 : 0.65,
      metalness: 0.3,
      roughness: 0.22,
    });
    this.railMaterials.push(pillarMat);

    const pillarGeo = new OctahedronGeometry(0.55, 0);
    const offset = half + thickness / 2;
    const steps = Math.min(28, Math.max(6, Math.round(size / 20)));
    for (let i = 0; i <= steps; i++) {
      const t = -offset + (i / steps) * (offset * 2);
      const isCorner = i === 0 || i === steps;
      const scale = isCorner ? 1.35 : 0.85;
      const positions: readonly [number, number][] = isCorner
        ? [
            [t, -offset],
            [t, offset],
          ]
        : [
            [t, -offset],
            [t, offset],
            [-offset, t],
            [offset, t],
          ];
      for (const [px, pz] of positions) {
        const gem = new Mesh(pillarGeo, pillarMat);
        gem.scale.set(0.9 * scale, 1.5 * scale, 0.9 * scale);
        gem.position.set(px, 0.18, pz);
        this.group.add(gem);
        this.wallMeshes.push(gem);
      }
    }
  }

  private buildCozyRainbowPortals(size: number, palette: ThemePalette): void {
    const half = size / 2;
    const repeats = Math.max(1, Math.round(size / 14));
    this.portalTexture = this.createRainbowPortalTexture(repeats);
    const portalMat = new MeshBasicMaterial({
      map: this.portalTexture,
      transparent: true,
      opacity: 0.56,
      side: DoubleSide,
      depthWrite: false,
    });
    this.portalMaterials.push(portalMat);

    const curtainGeo = new PlaneGeometry(size, 0.88);
    const walls: readonly { x: number; z: number; ry: number }[] = [
      { x: 0, z: -half, ry: 0 },
      { x: 0, z: half, ry: Math.PI },
      { x: -half, z: 0, ry: Math.PI / 2 },
      { x: half, z: 0, ry: -Math.PI / 2 },
    ];
    for (const w of walls) {
      const curtain = new Mesh(curtainGeo, portalMat);
      curtain.position.set(w.x, -0.06, w.z);
      curtain.rotation.y = w.ry;
      this.group.add(curtain);
      this.wallMeshes.push(curtain);
    }

    const starMat = new MeshStandardMaterial({
      color: 0xffffff,
      emissive: palette.framePrimary,
      emissiveIntensity: 0.72,
      metalness: 0.15,
      roughness: 0.2,
    });
    this.railMaterials.push(starMat);
    const starGeo = new OctahedronGeometry(0.42, 0);
    const steps = Math.min(28, Math.max(6, Math.round(size / 20)));
    for (let i = 0; i <= steps; i++) {
      const t = -half + (i / steps) * size;
      const isCorner = i === 0 || i === steps;
      const coords: readonly [number, number][] = isCorner
        ? [
            [t, -half],
            [t, half],
          ]
        : [
            [t, -half],
            [t, half],
            [-half, t],
            [half, t],
          ];
      for (const [cx, cz] of coords) {
        const star = new Mesh(starGeo, starMat);
        star.position.set(cx, 0.12, cz);
        this.group.add(star);
        this.wallMeshes.push(star);
      }
    }
  }

  /**
   * 512×512 seamless hexagonal honeycomb texture (`#e3b57d` lines on `#fbead1`),
   * scaled proportionally to `floorSpan` so cells keep consistent size on 560×560 worlds.
   */
  private createHoneycombTexture(floorSpan: number, palette: ThemePalette): CanvasTexture {
    const dim = 512;
    const canvas = document.createElement('canvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.fillStyle = palette.tileLightCss; // #fbead1
      ctx.fillRect(0, 0, dim, dim);

      // 7 cols × 8 even rows: dx/dy = 8/7 ≈ 1.143 (within 1% of sqrt(3)/1.5) and wraps 100% seamlessly.
      const cols = 7;
      const rows = 8;
      const dx = dim / cols;
      const dy = dim / rows;
      const halfDx = dx * 0.5;
      const sideHalf = dy / 3;
      const apexOffset = (2 * dy) / 3;

      ctx.strokeStyle = palette.tileBorderCss; // #e3b57d
      ctx.lineWidth = 2.6;
      ctx.lineJoin = 'round';

      for (let r = -1; r <= rows + 1; r++) {
        const rowShift = (Math.abs(r) % 2) * halfDx;
        const cy = r * dy;
        for (let c = -1; c <= cols + 1; c++) {
          const cx = c * dx + rowShift;

          ctx.beginPath();
          ctx.moveTo(cx, cy - apexOffset);
          ctx.lineTo(cx + halfDx, cy - sideHalf);
          ctx.lineTo(cx + halfDx, cy + sideHalf);
          ctx.lineTo(cx, cy + apexOffset);
          ctx.lineTo(cx - halfDx, cy + sideHalf);
          ctx.lineTo(cx - halfDx, cy - sideHalf);
          ctx.closePath();

          // Subtle tonal warmth on alternating hex cells for natural depth.
          if ((c + r) % 3 === 0) {
            ctx.fillStyle = 'rgba(227, 181, 125, 0.08)';
            ctx.fill();
          } else if ((c + r) % 3 === 1) {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.14)';
            ctx.fill();
          }
          ctx.stroke();
        }
      }
    }

    const repeats = Math.max(12, Math.round((floorSpan / 118) * 24));
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeats, repeats);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }

  private createTileTexture(size: number, palette: ThemePalette): CanvasTexture {
    const pxPerCell = 64;
    const tileCells = 2;
    const dim = tileCells * pxPerCell;
    const canvas = document.createElement('canvas');
    canvas.width = dim;
    canvas.height = dim;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      ctx.clearRect(0, 0, dim, dim);
      for (let z = 0; z < tileCells; z++) {
        for (let x = 0; x < tileCells; x++) {
          const isEven = (x + z) % 2 === 0;
          ctx.fillStyle = isEven ? palette.tileLightCss : palette.tileDarkCss;
          const px = x * pxPerCell;
          const pz = z * pxPerCell;
          ctx.fillRect(px + 2, pz + 2, pxPerCell - 4, pxPerCell - 4);

          if (palette.id === 'candy_island') {
            ctx.fillStyle = 'rgba(255, 255, 255, 0.24)';
            ctx.beginPath();
            ctx.arc(px + pxPerCell * 0.28, pz + pxPerCell * 0.28, 6, 0, Math.PI * 2);
            ctx.fill();
          } else {
            ctx.strokeStyle = palette.tileBorderCss;
            ctx.lineWidth = 2;
            ctx.strokeRect(px + 2.5, pz + 2.5, pxPerCell - 5, pxPerCell - 5);
          }
        }
      }
    }

    const repeatCount = Math.max(1, (size + 4) / 2);
    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.wrapT = RepeatWrapping;
    texture.repeat.set(repeatCount, repeatCount);
    texture.anisotropy = 4;
    texture.needsUpdate = true;
    return texture;
  }

  private createRainbowPortalTexture(repeats: number): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 256;
    canvas.height = 64;
    const ctx = canvas.getContext('2d');

    if (ctx) {
      const grad = ctx.createLinearGradient(0, 0, 256, 0);
      grad.addColorStop(0.0, '#ff85d0');
      grad.addColorStop(0.17, '#ffb685');
      grad.addColorStop(0.34, '#fff08a');
      grad.addColorStop(0.51, '#85ffd4');
      grad.addColorStop(0.68, '#80d8ff');
      grad.addColorStop(0.85, '#c799ff');
      grad.addColorStop(1.0, '#ff85d0');
      ctx.fillStyle = grad;
      ctx.fillRect(0, 0, 256, 64);

      ctx.globalCompositeOperation = 'destination-in';
      const alphaGrad = ctx.createLinearGradient(0, 0, 0, 64);
      alphaGrad.addColorStop(0, 'rgba(255,255,255,0.05)');
      alphaGrad.addColorStop(0.45, 'rgba(255,255,255,0.65)');
      alphaGrad.addColorStop(1, 'rgba(255,255,255,0.95)');
      ctx.fillStyle = alphaGrad;
      ctx.fillRect(0, 0, 256, 64);
    }

    const texture = new CanvasTexture(canvas);
    texture.colorSpace = SRGBColorSpace;
    texture.wrapS = RepeatWrapping;
    texture.repeat.set(repeats, 1);
    texture.needsUpdate = true;
    return texture;
  }

  private disposeMeshes(): void {
    this.hideShrinkPreview();

    const disposables: DisposableObj[] = [];
    if (this.floor) disposables.push(this.floor);
    if (this.grid) disposables.push(this.grid);
    if (this.frame) disposables.push(this.frame);
    for (const m of this.wallMeshes) disposables.push(m);

    const disposedGeos = new Set<{ dispose(): void }>();
    const disposedMats = new Set<{ dispose(): void }>();

    for (const obj of disposables) {
      this.group.remove(obj as unknown as Mesh);
      if (!disposedGeos.has(obj.geometry)) {
        obj.geometry.dispose();
        disposedGeos.add(obj.geometry);
      }
      if (Array.isArray(obj.material)) {
        for (const mat of obj.material) {
          if (!disposedMats.has(mat)) {
            mat.dispose();
            disposedMats.add(mat);
          }
        }
      } else if (!disposedMats.has(obj.material)) {
        obj.material.dispose();
        disposedMats.add(obj.material);
      }
    }

    this.floorTexture?.dispose();
    this.floorTexture = undefined;
    this.portalTexture?.dispose();
    this.portalTexture = undefined;

    this.floor = undefined;
    this.grid = undefined;
    this.frame = undefined;
    this.wallMeshes = [];
    this.portalMaterials = [];
    this.railMaterials = [];
  }
}
