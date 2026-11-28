import {
  CanvasTexture,
  ClampToEdgeWrapping,
  LinearFilter,
  LinearMipmapLinearFilter,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
} from 'three';
import type { VisualTheme } from '../core/types';

/** Complete bundle of deterministic procedural terrain textures and their cleanup hook. */
export interface TerrainTextureSet {
  readonly albedoMap: CanvasTexture;
  readonly bumpMap: CanvasTexture;
  readonly roughnessMap: CanvasTexture;
  readonly lagoonWaterMap: CanvasTexture;
  readonly lagoonFoamMap: CanvasTexture;
  readonly iceSheetMap: CanvasTexture;
  readonly sakuraPetalMap: CanvasTexture;
  readonly woodlandMossMap: CanvasTexture;
  readonly courtyardStoneMap: CanvasTexture;
  dispose(): void;
}

interface SeededRng {
  next(): number;
}

/** Deterministic Mulberry32 PRNG — zero `Math.random()`. */
function createSeededRng(seed: number): SeededRng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { next };
}

function hashInt2D(ix: number, iy: number, seed: number): number {
  let h = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed, 1442695041);
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Seamless toroidal 2D value noise over `[0, 1) x [0, 1)` with integer period `freq`. */
function periodicNoise2D(u: number, v: number, freq: number, seed: number): number {
  const x = u * freq;
  const y = v * freq;
  const ix0 = Math.floor(x);
  const iy0 = Math.floor(y);
  const fx = x - ix0;
  const fy = y - iy0;
  const sx = fx * fx * (3 - 2 * fx);
  const sy = fy * fy * (3 - 2 * fy);

  const wx0 = ((ix0 % freq) + freq) % freq;
  const wy0 = ((iy0 % freq) + freq) % freq;
  const wx1 = (wx0 + 1) % freq;
  const wy1 = (wy0 + 1) % freq;

  const n00 = hashInt2D(wx0, wy0, seed);
  const n10 = hashInt2D(wx1, wy0, seed);
  const n01 = hashInt2D(wx0, wy1, seed);
  const n11 = hashInt2D(wx1, wy1, seed);

  const nx0 = n00 + (n10 - n00) * sx;
  const nx1 = n01 + (n11 - n01) * sx;
  return nx0 + (nx1 - nx0) * sy;
}

function clampByte(v: number): number {
  return v < 0 ? 0 : v > 255 ? 255 : Math.round(v);
}

function makeCanvas(dim: number): {
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D | null;
} {
  const canvas = document.createElement('canvas');
  canvas.width = dim;
  canvas.height = dim;
  return { canvas, ctx: canvas.getContext('2d') };
}

function finalizeTexture(
  canvas: HTMLCanvasElement,
  isColor: boolean,
  repeat: boolean,
  anisotropy = 4,
): CanvasTexture {
  const texture = new CanvasTexture(canvas);
  texture.colorSpace = isColor ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.wrapT = repeat ? RepeatWrapping : ClampToEdgeWrapping;
  texture.magFilter = LinearFilter;
  texture.minFilter = LinearMipmapLinearFilter;
  texture.anisotropy = anisotropy;
  texture.needsUpdate = true;
  return texture;
}

/**
 * Draw an organic feature across toroidal 3x3 edge copies when near canvas boundaries
 * so tiled textures stay 100% seamless without visible borders.
 */
function drawSeamless(
  dim: number,
  x: number,
  y: number,
  margin: number,
  drawAt: (ox: number, oy: number) => void,
): void {
  const minX = x < margin ? -1 : 0;
  const maxX = x > dim - margin ? 1 : 0;
  const minY = y < margin ? -1 : 0;
  const maxY = y > dim - margin ? 1 : 0;
  for (let dy = minY; dy <= maxY; dy++) {
    for (let dx = minX; dx <= maxX; dx++) {
      drawAt(x + dx * dim, y + dy * dim);
    }
  }
}

/**
 * Generate matched 1024x1024 seamless ground albedo, bump, and roughness maps
 * from a single multi-octave natural micro-heightfield + organic grass fibers & pebbles.
 */
function createMatchedGroundPbrMaps(): {
  albedoMap: CanvasTexture;
  bumpMap: CanvasTexture;
  roughnessMap: CanvasTexture;
} {
  const dim = 1024;
  const albedo = makeCanvas(dim);
  const bump = makeCanvas(dim);
  const rough = makeCanvas(dim);

  if (albedo.ctx && bump.ctx && rough.ctx) {
    const aImg = albedo.ctx.createImageData(dim, dim);
    const bImg = bump.ctx.createImageData(dim, dim);
    const rImg = rough.ctx.createImageData(dim, dim);
    const aData = aImg.data;
    const bData = bImg.data;
    const rData = rImg.data;

    const invDim = 1 / dim;
    for (let y = 0; y < dim; y++) {
      const v = y * invDim;
      for (let x = 0; x < dim; x++) {
        const u = x * invDim;

        // Multi-scale seamless soil/turf undulation + fine mineral grain
        const nMacro = periodicNoise2D(u, v, 8, 101);
        const nMed = periodicNoise2D(u, v, 24, 211);
        const nFine = periodicNoise2D(u, v, 64, 307);
        const nMicro = periodicNoise2D(u, v, 160, 409);
        const grain = hashInt2D(x, y, 521);

        // Directional grass/fiber micro-streak
        const fiber = periodicNoise2D(u * 1.0 + v * 0.28, v * 2.5, 48, 613);

        const height =
          nMacro * 0.34 + nMed * 0.26 + nFine * 0.18 + nMicro * 0.12 + fiber * 0.06 + grain * 0.04;

        // Albedo kept bright-neutral (208..250) so vertex biome colors supply vivid natural hues
        const lumBase = 212 + (height - 0.5) * 44 + (grain - 0.5) * 14;
        const warmShift = (nMed - 0.5) * 8;
        const idx = (y * dim + x) * 4;

        aData[idx] = clampByte(lumBase + warmShift);
        aData[idx + 1] = clampByte(lumBase + (fiber - 0.5) * 8);
        aData[idx + 2] = clampByte(lumBase - warmShift * 0.8);
        aData[idx + 3] = 255;

        const bumpVal = clampByte(height * 255);
        bData[idx] = bumpVal;
        bData[idx + 1] = bumpVal;
        bData[idx + 2] = bumpVal;
        bData[idx + 3] = 255;

        // Organic roughness variation: troughs/fibers rougher (0.88..0.96), exposed grains smoother (0.64..0.78)
        const roughVal = clampByte(226 - (height - 0.5) * 62 - (nFine - 0.5) * 24);
        rData[idx] = roughVal;
        rData[idx + 1] = roughVal;
        rData[idx + 2] = roughVal;
        rData[idx + 3] = 255;
      }
    }

    albedo.ctx.putImageData(aImg, 0, 0);
    bump.ctx.putImageData(bImg, 0, 0);
    rough.ctx.putImageData(rImg, 0, 0);

    // Layer crisp seeded organic grass blades, soil fibers, and tiny mineral pebbles seamlessly
    const rng = createSeededRng(7391);
    for (let i = 0; i < 2400; i++) {
      const px = rng.next() * dim;
      const py = rng.next() * dim;
      const len = 5 + rng.next() * 9;
      const ang = -Math.PI * 0.5 + (rng.next() - 0.5) * 1.4;
      const dx = Math.cos(ang) * len;
      const dy = Math.sin(ang) * len;
      const light = rng.next() > 0.48;

      drawSeamless(dim, px, py, 16, (ox, oy) => {
        albedo.ctx!.strokeStyle = light ? 'rgba(255, 255, 250, 0.16)' : 'rgba(130, 138, 122, 0.16)';
        albedo.ctx!.lineWidth = 1.1;
        albedo.ctx!.beginPath();
        albedo.ctx!.moveTo(ox, oy);
        albedo.ctx!.lineTo(ox + dx, oy + dy);
        albedo.ctx!.stroke();

        bump.ctx!.strokeStyle = light ? 'rgba(235, 235, 235, 0.22)' : 'rgba(85, 85, 85, 0.18)';
        bump.ctx!.lineWidth = 1.2;
        bump.ctx!.beginPath();
        bump.ctx!.moveTo(ox, oy);
        bump.ctx!.lineTo(ox + dx, oy + dy);
        bump.ctx!.stroke();
      });
    }

    // Small mineral pebbles & quartz flecks
    for (let i = 0; i < 650; i++) {
      const px = rng.next() * dim;
      const py = rng.next() * dim;
      const rx = 1.2 + rng.next() * 2.4;
      const ry = rx * (0.6 + rng.next() * 0.4);
      const rot = rng.next() * Math.PI;
      const isQuartz = rng.next() > 0.65;

      drawSeamless(dim, px, py, 8, (ox, oy) => {
        albedo.ctx!.save();
        albedo.ctx!.translate(ox, oy);
        albedo.ctx!.rotate(rot);
        albedo.ctx!.fillStyle = isQuartz
          ? 'rgba(252, 250, 242, 0.24)'
          : 'rgba(155, 148, 138, 0.22)';
        albedo.ctx!.beginPath();
        albedo.ctx!.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        albedo.ctx!.fill();
        albedo.ctx!.restore();

        bump.ctx!.save();
        bump.ctx!.translate(ox, oy);
        bump.ctx!.rotate(rot);
        bump.ctx!.fillStyle = 'rgba(220, 220, 220, 0.28)';
        bump.ctx!.beginPath();
        bump.ctx!.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        bump.ctx!.fill();
        bump.ctx!.restore();

        rough.ctx!.save();
        rough.ctx!.translate(ox, oy);
        rough.ctx!.rotate(rot);
        rough.ctx!.fillStyle = isQuartz ? 'rgba(140, 140, 140, 0.35)' : 'rgba(175, 175, 175, 0.3)';
        rough.ctx!.beginPath();
        rough.ctx!.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        rough.ctx!.fill();
        rough.ctx!.restore();
      });
    }
  }

  return {
    albedoMap: finalizeTexture(albedo.canvas, true, true, 8),
    bumpMap: finalizeTexture(bump.canvas, false, true, 8),
    roughnessMap: finalizeTexture(rough.canvas, false, true, 8),
  };
}

/**
 * 512x512 seamless animated turquoise lagoon water with sunlit caustic web ripples.
 */
function createLagoonWaterTexture(theme: VisualTheme): CanvasTexture {
  const dim = 512;
  const { canvas, ctx } = makeCanvas(dim);
  const isDark = theme === 'crystal_garden' || theme === 'starlight_galaxy';

  if (ctx) {
    const img = ctx.createImageData(dim, dim);
    const data = img.data;
    const invDim = 1 / dim;

    for (let y = 0; y < dim; y++) {
      const v = y * invDim;
      for (let x = 0; x < dim; x++) {
        const u = x * invDim;
        // Overlapping periodic wave interference for sunlit water caustics
        const n1 = periodicNoise2D(u, v, 6, 811);
        const n2 = periodicNoise2D(u + 0.17, v + 0.31, 10, 919);
        const waveA = Math.sin((u * 6 + n1 * 1.4) * Math.PI * 2);
        const waveB = Math.cos((v * 6 - n2 * 1.4) * Math.PI * 2);
        const causticField = Math.abs(waveA + waveB) * 0.5;
        const caustic = Math.pow(Math.max(0, 1 - causticField * 1.35), 2.4);

        const baseR = isDark ? 26 : 36;
        const baseG = isDark ? 148 : 196;
        const baseB = isDark ? 186 : 216;
        const shimmer = caustic * (isDark ? 95 : 118) + n2 * 18;

        const idx = (y * dim + x) * 4;
        data[idx] = clampByte(baseR + shimmer * 0.72);
        data[idx + 1] = clampByte(baseG + shimmer * 0.92);
        data[idx + 2] = clampByte(baseB + shimmer * 0.85);
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  return finalizeTexture(canvas, true, true, 4);
}

/**
 * 512x512 seamless frothy sea-foam speckle overlay for lagoon shoreline waves.
 */
function createLagoonFoamTexture(): CanvasTexture {
  const dim = 512;
  const { canvas, ctx } = makeCanvas(dim);

  if (ctx) {
    ctx.clearRect(0, 0, dim, dim);
    const rng = createSeededRng(4281);

    for (let i = 0; i < 420; i++) {
      const x = rng.next() * dim;
      const y = rng.next() * dim;
      const r = 4 + rng.next() * 14;
      const alpha = 0.14 + rng.next() * 0.24;

      drawSeamless(dim, x, y, r + 4, (ox, oy) => {
        const g = ctx.createRadialGradient(ox, oy, 0, ox, oy, r);
        g.addColorStop(0, `rgba(244, 254, 255, ${alpha})`);
        g.addColorStop(0.6, `rgba(205, 248, 255, ${alpha * 0.55})`);
        g.addColorStop(1, 'rgba(205, 248, 255, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }
  }

  return finalizeTexture(canvas, true, true, 4);
}

/**
 * 512x512 seamless frosted crystalline glacier ice-sheet texture with fracture veins.
 */
function createIceSheetTexture(theme: VisualTheme): CanvasTexture {
  const dim = 512;
  const { canvas, ctx } = makeCanvas(dim);
  const isDark = theme === 'crystal_garden' || theme === 'starlight_galaxy';

  if (ctx) {
    const img = ctx.createImageData(dim, dim);
    const data = img.data;
    const invDim = 1 / dim;

    for (let y = 0; y < dim; y++) {
      const v = y * invDim;
      for (let x = 0; x < dim; x++) {
        const u = x * invDim;
        const n1 = periodicNoise2D(u, v, 6, 1201);
        const n2 = periodicNoise2D(u, v, 18, 1303);
        const n3 = periodicNoise2D(u, v, 48, 1409);

        const frost = n1 * 0.5 + n2 * 0.32 + n3 * 0.18;
        const idx = (y * dim + x) * 4;

        if (isDark) {
          data[idx] = clampByte(112 + frost * 85);
          data[idx + 1] = clampByte(170 + frost * 72);
          data[idx + 2] = clampByte(228 + frost * 27);
        } else {
          data[idx] = clampByte(168 + frost * 72);
          data[idx + 1] = clampByte(218 + frost * 34);
          data[idx + 2] = clampByte(246 + frost * 9);
        }
        data[idx + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // Crystalline hairline glacier cracks & frost facets
    const rng = createSeededRng(9817);
    ctx.lineCap = 'round';
    for (let i = 0; i < 64; i++) {
      const x0 = rng.next() * dim;
      const y0 = rng.next() * dim;
      const ang = rng.next() * Math.PI * 2;
      const len = 24 + rng.next() * 68;
      const midAng = ang + (rng.next() - 0.5) * 0.5;
      const xm = x0 + Math.cos(midAng) * (len * 0.5);
      const ym = y0 + Math.sin(midAng) * (len * 0.5);
      const x1 = x0 + Math.cos(ang) * len;
      const y1 = y0 + Math.sin(ang) * len;

      drawSeamless(dim, x0, y0, len + 4, (ox, oy) => {
        const dx = ox - x0;
        const dy = oy - y0;
        ctx.strokeStyle = isDark ? 'rgba(215, 246, 255, 0.36)' : 'rgba(255, 255, 255, 0.58)';
        ctx.lineWidth = 1.1 + (i % 3) * 0.45;
        ctx.beginPath();
        ctx.moveTo(ox, oy);
        ctx.lineTo(xm + dx, ym + dy);
        ctx.lineTo(x1 + dx, y1 + dy);
        ctx.stroke();
      });
    }
  }

  return finalizeTexture(canvas, true, true, 4);
}

/**
 * 512x512 seamless fallen sakura cherry-blossom petal carpet overlay (transparent background).
 */
function createSakuraPetalTexture(theme: VisualTheme): CanvasTexture {
  const dim = 512;
  const { canvas, ctx } = makeCanvas(dim);
  const isDark = theme === 'crystal_garden' || theme === 'starlight_galaxy';

  if (ctx) {
    ctx.clearRect(0, 0, dim, dim);
    const rng = createSeededRng(5521);
    const petalColors = isDark
      ? [
          'rgba(242, 165, 208, 0.85)',
          'rgba(255, 198, 228, 0.82)',
          'rgba(220, 128, 180, 0.78)',
          'rgba(255, 228, 242, 0.72)',
        ]
      : [
          'rgba(255, 178, 208, 0.90)',
          'rgba(255, 206, 226, 0.88)',
          'rgba(246, 142, 182, 0.82)',
          'rgba(255, 236, 244, 0.84)',
        ];

    // Soft rose petal cluster smudges underneath
    for (let i = 0; i < 36; i++) {
      const cx = rng.next() * dim;
      const cy = rng.next() * dim;
      const rad = 22 + rng.next() * 34;
      drawSeamless(dim, cx, cy, rad + 4, (ox, oy) => {
        const g = ctx.createRadialGradient(ox, oy, 2, ox, oy, rad);
        g.addColorStop(0, isDark ? 'rgba(218, 130, 178, 0.24)' : 'rgba(255, 188, 214, 0.28)');
        g.addColorStop(1, 'rgba(255, 188, 214, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ox, oy, rad, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Individual fallen cherry-blossom petals
    for (let i = 0; i < 680; i++) {
      const px = rng.next() * dim;
      const py = rng.next() * dim;
      const size = 2.6 + rng.next() * 4.2;
      const rot = rng.next() * Math.PI * 2;
      const color = petalColors[i % petalColors.length]!;

      drawSeamless(dim, px, py, size * 2 + 2, (ox, oy) => {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate(rot);
        ctx.fillStyle = color;
        ctx.beginPath();
        ctx.moveTo(0, -size);
        ctx.quadraticCurveTo(size * 0.78, -size * 0.2, 0, size);
        ctx.quadraticCurveTo(-size * 0.78, -size * 0.2, 0, -size);
        ctx.fill();
        ctx.restore();
      });
    }
  }

  return finalizeTexture(canvas, true, true, 4);
}

/**
 * 512x512 seamless mossy woodland glade & fallen forest leaf-litter detail texture.
 */
function createWoodlandMossTexture(theme: VisualTheme): CanvasTexture {
  const dim = 512;
  const { canvas, ctx } = makeCanvas(dim);
  const isDark = theme === 'crystal_garden' || theme === 'starlight_galaxy';

  if (ctx) {
    ctx.clearRect(0, 0, dim, dim);
    const rng = createSeededRng(3347);

    // Emerald moss cushions
    for (let i = 0; i < 95; i++) {
      const cx = rng.next() * dim;
      const cy = rng.next() * dim;
      const r = 14 + rng.next() * 28;
      const c = isDark ? 'rgba(32, 118, 76, 0.34)' : 'rgba(42, 128, 62, 0.36)';
      drawSeamless(dim, cx, cy, r + 4, (ox, oy) => {
        const g = ctx.createRadialGradient(ox, oy, 2, ox, oy, r);
        g.addColorStop(0, c);
        g.addColorStop(1, 'rgba(42, 128, 62, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        ctx.arc(ox, oy, r, 0, Math.PI * 2);
        ctx.fill();
      });
    }

    // Damp forest leaf litter & tiny clover specks
    for (let i = 0; i < 420; i++) {
      const px = rng.next() * dim;
      const py = rng.next() * dim;
      const rx = 2.2 + rng.next() * 3.6;
      const ry = rx * 0.55;
      const rot = rng.next() * Math.PI * 2;
      const isMossDot = i % 3 !== 0;

      drawSeamless(dim, px, py, 10, (ox, oy) => {
        ctx.save();
        ctx.translate(ox, oy);
        ctx.rotate(rot);
        ctx.fillStyle = isMossDot
          ? isDark
            ? 'rgba(66, 178, 118, 0.38)'
            : 'rgba(72, 165, 76, 0.44)'
          : isDark
            ? 'rgba(138, 114, 62, 0.32)'
            : 'rgba(156, 124, 64, 0.40)';
        ctx.beginPath();
        ctx.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      });
    }
  }

  return finalizeTexture(canvas, true, true, 4);
}

/**
 * 512x512 seamless warm sunlit marble & limestone courtyard flagstone masonry texture.
 */
function createCourtyardStoneTexture(theme: VisualTheme): CanvasTexture {
  const dim = 512;
  const { canvas, ctx } = makeCanvas(dim);
  const isDark = theme === 'crystal_garden' || theme === 'starlight_galaxy';

  if (ctx) {
    ctx.fillStyle = isDark ? '#5a6380' : '#e6dac0';
    ctx.fillRect(0, 0, dim, dim);

    const rng = createSeededRng(2089);
    const rows = 8;
    const cols = 4;
    const rowH = dim / rows;
    const colW = dim / cols;

    for (let r = 0; r < rows; r++) {
      const xOffset = (r % 2) * (colW * 0.5);
      for (let c = -1; c <= cols; c++) {
        const sx = c * colW + xOffset;
        const sy = r * rowH;
        const tone = rng.next();
        const shade = Math.round((tone - 0.5) * 18);

        if (isDark) {
          ctx.fillStyle = `rgb(${92 + shade}, ${102 + shade}, ${134 + shade})`;
        } else if (theme === 'candy_island') {
          ctx.fillStyle = `rgb(${246 + shade}, ${230 + shade}, ${228 + shade})`;
        } else {
          ctx.fillStyle = `rgb(${232 + shade}, ${218 + shade}, ${188 + shade})`;
        }
        ctx.fillRect(sx + 2, sy + 2, colW - 4, rowH - 4);

        // Subtle stone edge highlight & warm mortar bevel
        ctx.strokeStyle = isDark ? 'rgba(170, 190, 230, 0.16)' : 'rgba(255, 250, 238, 0.42)';
        ctx.lineWidth = 1.5;
        ctx.strokeRect(sx + 3, sy + 3, colW - 6, rowH - 6);
      }
    }

    // Subtle limestone mineral speckles
    for (let i = 0; i < 600; i++) {
      const px = rng.next() * dim;
      const py = rng.next() * dim;
      const rad = 0.8 + rng.next() * 1.6;
      ctx.fillStyle =
        i % 2 === 0
          ? isDark
            ? 'rgba(210, 224, 255, 0.08)'
            : 'rgba(182, 162, 128, 0.14)'
          : 'rgba(255, 255, 255, 0.12)';
      ctx.beginPath();
      ctx.arc(px, py, rad, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  return finalizeTexture(canvas, true, true, 4);
}

/**
 * Create the complete deterministic procedural terrain texture set for `theme`.
 * Call `.dispose()` on cleanup to release every GPU texture cleanly.
 */
export function createTerrainTextureSet(theme: VisualTheme): TerrainTextureSet {
  const { albedoMap, bumpMap, roughnessMap } = createMatchedGroundPbrMaps();
  const lagoonWaterMap = createLagoonWaterTexture(theme);
  const lagoonFoamMap = createLagoonFoamTexture();
  const iceSheetMap = createIceSheetTexture(theme);
  const sakuraPetalMap = createSakuraPetalTexture(theme);
  const woodlandMossMap = createWoodlandMossTexture(theme);
  const courtyardStoneMap = createCourtyardStoneTexture(theme);

  return {
    albedoMap,
    bumpMap,
    roughnessMap,
    lagoonWaterMap,
    lagoonFoamMap,
    iceSheetMap,
    sakuraPetalMap,
    woodlandMossMap,
    courtyardStoneMap,
    dispose(): void {
      albedoMap.dispose();
      bumpMap.dispose();
      roughnessMap.dispose();
      lagoonWaterMap.dispose();
      lagoonFoamMap.dispose();
      iceSheetMap.dispose();
      sakuraPetalMap.dispose();
      woodlandMossMap.dispose();
      courtyardStoneMap.dispose();
    },
  };
}
