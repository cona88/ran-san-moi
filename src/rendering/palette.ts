import type { VisualTheme } from '../core/types';

/** Shared base palette (hex literals) kept for compatibility and accents. */
export const COLORS = {
  cyan: 0x38f6ff,
  magenta: 0xff5ec4,
  purple: 0xb06cff,
  head: 0xfff0fa,
  food: 0xff7eb9,
  background: 0x16092e,
} as const;

export type AmbientParticleStyle = 'pollen' | 'petals' | 'stars' | 'bubbles';

export interface ThemePalette {
  readonly id: VisualTheme;
  readonly nameVi: string;
  readonly background: number;
  readonly fogColor: number;
  readonly floorBase: number;
  readonly tileLightCss: string;
  readonly tileDarkCss: string;
  readonly tileBorderCss: string;
  readonly gridCenter: number;
  readonly gridLine: number;
  readonly gridOpacity: number;
  readonly framePrimary: number;
  readonly frameSecondary: number;
  readonly frameGameOver: number;
  readonly pillarColor: number;
  readonly ambientColor: number;
  readonly ambientIntensity: number;
  readonly dirColor: number;
  readonly dirIntensity: number;
  readonly fillColor: number;
  readonly fillIntensity: number;
  readonly accentColor: number;
  readonly accentIntensity: number;
  readonly foodColor: number;
  readonly foodEmissive: number;
  readonly bonusColor: number;
  readonly particleStyle: AmbientParticleStyle;
  readonly ambientColors: readonly number[];
}

export const THEMES: Record<VisualTheme, ThemePalette> = {
  honeycomb_arena: {
    id: 'honeycomb_arena',
    nameVi: '🍯 Đấu Trường Tổ Ong Vàng',
    background: 0xf7e4c5,
    fogColor: 0xf7e4c5,
    floorBase: 0xf7ebd9,
    tileLightCss: '#fbead1',
    tileDarkCss: '#f5dec0',
    tileBorderCss: '#e3b57d',
    gridCenter: 0xe3b57d,
    gridLine: 0xe3b57d,
    gridOpacity: 0,
    framePrimary: 0xf59e0b,
    frameSecondary: 0xfb923c,
    frameGameOver: 0xef4444,
    pillarColor: 0xfcd34d,
    ambientColor: 0xfff4df,
    ambientIntensity: 1.35,
    dirColor: 0xfff9ee,
    dirIntensity: 0.92,
    fillColor: 0xffd28a,
    fillIntensity: 0.28,
    accentColor: 0xffb74d,
    accentIntensity: 0.24,
    foodColor: 0xffd43b,
    foodEmissive: 0xffa91f,
    bonusColor: 0xff80cc,
    particleStyle: 'pollen',
    ambientColors: [0xf59e0b, 0xfbbf24, 0xfde68a, 0xfb923c],
  },
  crystal_garden: {
    id: 'crystal_garden',
    nameVi: '🌸 Vườn Pha Lê Tím Hồng',
    background: 0x180a33,
    fogColor: 0x1e0d3d,
    floorBase: 0x26124a,
    tileLightCss: 'rgba(186, 130, 255, 0.22)',
    tileDarkCss: 'rgba(66, 28, 120, 0.36)',
    tileBorderCss: 'rgba(255, 168, 229, 0.22)',
    gridCenter: 0xff9ee6,
    gridLine: 0x7ef7e4,
    gridOpacity: 0.26,
    framePrimary: 0x6ef7dc,
    frameSecondary: 0xff8ce0,
    frameGameOver: 0xff6b9d,
    pillarColor: 0xd99eff,
    ambientColor: 0xc9a8ff,
    ambientIntensity: 1.1,
    dirColor: 0xfff5fc,
    dirIntensity: 0.85,
    fillColor: 0xff7ad9,
    fillIntensity: 0.7,
    accentColor: 0x6cf7df,
    accentIntensity: 0.6,
    foodColor: 0xff75c3,
    foodEmissive: 0xff49aa,
    bonusColor: 0xffe266,
    particleStyle: 'petals',
    ambientColors: [0xff9ce6, 0x82ffe8, 0xd9adff, 0xfff0a6],
  },
  starlight_galaxy: {
    id: 'starlight_galaxy',
    nameVi: '🌌 Ngân Hà Ánh Sao',
    background: 0x070f2b,
    fogColor: 0x0b1538,
    floorBase: 0x101c48,
    tileLightCss: 'rgba(116, 184, 255, 0.19)',
    tileDarkCss: 'rgba(22, 34, 92, 0.42)',
    tileBorderCss: 'rgba(160, 224, 255, 0.2)',
    gridCenter: 0x8be9ff,
    gridLine: 0x9b8cff,
    gridOpacity: 0.24,
    framePrimary: 0x72dcff,
    frameSecondary: 0xd18eff,
    frameGameOver: 0xff73a8,
    pillarColor: 0x9ee8ff,
    ambientColor: 0x9bbdff,
    ambientIntensity: 1.05,
    dirColor: 0xf2f7ff,
    dirIntensity: 0.85,
    fillColor: 0xa682ff,
    fillIntensity: 0.65,
    accentColor: 0x5df2ff,
    accentIntensity: 0.6,
    foodColor: 0xffda5e,
    foodEmissive: 0xffb833,
    bonusColor: 0xff8ef7,
    particleStyle: 'stars',
    ambientColors: [0xffffff, 0x9ae8ff, 0xffe58c, 0xdcb0ff],
  },
  candy_island: {
    id: 'candy_island',
    nameVi: '🍬 Đảo Kẹo Ngọt',
    background: 0x8c5f78,
    fogColor: 0x92657d,
    floorBase: 0xb87f9d,
    tileLightCss: 'rgba(255, 206, 224, 0.56)',
    tileDarkCss: 'rgba(156, 240, 218, 0.48)',
    tileBorderCss: 'rgba(255, 242, 248, 0.36)',
    gridCenter: 0xffc2e2,
    gridLine: 0x99f5df,
    gridOpacity: 0.3,
    framePrimary: 0xffb0dc,
    frameSecondary: 0x8ff5dd,
    frameGameOver: 0xff6e8a,
    pillarColor: 0xffcbe8,
    ambientColor: 0xffeef7,
    ambientIntensity: 1.25,
    dirColor: 0xfffaf2,
    dirIntensity: 0.8,
    fillColor: 0xff9ad1,
    fillIntensity: 0.55,
    accentColor: 0x8ff5dd,
    accentIntensity: 0.5,
    foodColor: 0xff66b3,
    foodEmissive: 0xff4299,
    bonusColor: 0xffe054,
    particleStyle: 'bubbles',
    ambientColors: [0xffc4e6, 0xa3ffea, 0xffe99c, 0xffb3c8],
  },
};
