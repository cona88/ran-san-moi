/**
 * "Cuộc Phiêu Lưu Vương Quốc Đồ Sộ" — Colossal Open-World Adventure.
 *
 * Pure, deterministic, zero-RNG region partitioning, 6 colossal landmarks,
 * 4-chapter wonder progression, and nearest-undiscovered-wonder compass lookup.
 */
import { computeLeaderboard } from './bots';
import { appendEvents, applyXpAndScore, type EventDraft } from './quests';
import type {
  AdventureRegion,
  AdventureRegionId,
  GameState,
  RegionClimate,
  ShelterKind,
  Vec2,
  WorldLandmark,
} from './types';

export const LANDMARK_DISCOVERY_SCORE = 200;
export const LANDMARK_DISCOVERY_XP = 12;
export const LANDMARK_BUTTERFLY_CHARGE_BONUS = 25;
export const CHAPTER_XP_REWARD = 15;

export const ADVENTURE_REGIONS: Readonly<Record<AdventureRegionId, AdventureRegion>> = {
  royal_citadel: {
    id: 'royal_citadel',
    nameVi: '🏰 Hoàng Thành Ánh Vàng',
    icon: '🏰',
    colorHex: 0xffd700,
  },
  mushroom_woods: {
    id: 'mushroom_woods',
    nameVi: '🍄 Rừng Nấm Cổ Thụ',
    icon: '🍄',
    colorHex: 0xff69b4,
  },
  crystal_sanctum: {
    id: 'crystal_sanctum',
    nameVi: '💎 Thánh Điện Pha Lê',
    icon: '💎',
    colorHex: 0x00ffff,
  },
  mermaid_lagoon: {
    id: 'mermaid_lagoon',
    nameVi: '🧜‍♀️ Vịnh Tiên Cá Ngọc Bích',
    icon: '🧜‍♀️',
    colorHex: 0x00e5ff,
  },
  candy_highlands: {
    id: 'candy_highlands',
    nameVi: '🍭 Đồi Kẹo Cầu Vồng',
    icon: '🍭',
    colorHex: 0xff69b4,
  },
  blossom_valley: {
    id: 'blossom_valley',
    nameVi: '🌸 Thung Lũng Hoa Anh Đào',
    icon: '🌸',
    colorHex: 0xff85c0,
  },
  starlight_peaks: {
    id: 'starlight_peaks',
    nameVi: '⭐ Đỉnh Tinh Tú Ánh Sao',
    icon: '⭐',
    colorHex: 0xb388ff,
  },
};

export const REGION_CLIMATES: Readonly<Record<AdventureRegionId, RegionClimate>> = {
  royal_citadel: {
    id: 'temperate_sunny',
    regionId: 'royal_citadel',
    nameVi: 'Ôn Đới Nắng Vàng',
    weatherVi: 'Nắng ấm • Phấn hoa vàng',
    icon: '☀️',
    temperatureC: 24,
    accentHex: 0xffd54f,
  },
  mushroom_woods: {
    id: 'misty_rainforest',
    regionId: 'mushroom_woods',
    nameVi: 'Rừng Mưa Ẩm',
    weatherVi: 'Sương mù • Đom đóm rừng',
    icon: '🌫️',
    temperatureC: 21,
    accentHex: 0x4ee6a8,
  },
  blossom_valley: {
    id: 'spring_blossom',
    regionId: 'blossom_valley',
    nameVi: 'Mùa Xuân Anh Đào',
    weatherVi: 'Gió xuân • Mưa cánh hoa',
    icon: '🌸',
    temperatureC: 19,
    accentHex: 0xff8ec7,
  },
  crystal_sanctum: {
    id: 'alpine_frost',
    regionId: 'crystal_sanctum',
    nameVi: 'Hàn Đới Băng Tuyết',
    weatherVi: 'Giá rét • Tuyết rơi lấp lánh',
    icon: '❄️',
    temperatureC: -6,
    accentHex: 0x7ce8ff,
  },
  mermaid_lagoon: {
    id: 'tropical_lagoon',
    regionId: 'mermaid_lagoon',
    nameVi: 'Nhiệt Đới Biển Đảo',
    weatherVi: 'Nắng biển • Bọt sóng xanh',
    icon: '🏝️',
    temperatureC: 29,
    accentHex: 0x26e8ff,
  },
  candy_highlands: {
    id: 'golden_highlands',
    regionId: 'candy_highlands',
    nameVi: 'Cao Nguyên Nắng Ấm',
    weatherVi: 'Chiều vàng • Bụi nắng mật ong',
    icon: '🌤️',
    temperatureC: 26,
    accentHex: 0xffb36b,
  },
  starlight_peaks: {
    id: 'aurora_peaks',
    regionId: 'starlight_peaks',
    nameVi: 'Núi Cao Cực Quang',
    weatherVi: 'Chạng vạng • Tuyết sao cực quang',
    icon: '🌌',
    temperatureC: -2,
    accentHex: 0xb78cff,
  },
};

/**
 * 6 Colossal Wonders distributed across the 560x560 kingdom (`dist >= 80` from `(0,0)`
 * and `>= 40u` away from every sanctuary in `DEFAULT_SHELTERS`).
 */
export const DEFAULT_LANDMARKS: readonly WorldLandmark[] = [
  {
    id: 'landmark-world-tree',
    kind: 'world_tree',
    nameVi: '🌳 Đại Thụ Thế Giới Ngàn Năm',
    icon: '🌳',
    x: -82,
    z: -62,
    radius: 14,
    colorHex: 0x6ef29a,
  },
  {
    id: 'landmark-rainbow-arch',
    kind: 'rainbow_arch',
    nameVi: '🌈 Cổng Cầu Vồng Ngân Hà',
    icon: '🌈',
    x: 82,
    z: -62,
    radius: 14,
    colorHex: 0xff85d0,
  },
  {
    id: 'landmark-crystal-falls',
    kind: 'crystal_falls',
    nameVi: '💎 Thác Pha Lê Vĩnh Cửu',
    icon: '💎',
    x: -88,
    z: 68,
    radius: 14,
    colorHex: 0x38f6ff,
  },
  {
    id: 'landmark-astral-observatory',
    kind: 'astral_observatory',
    nameVi: '🔭 Đài Thiên Văn Tinh Tú',
    icon: '🔭',
    x: 88,
    z: 68,
    radius: 14,
    colorHex: 0xffd700,
  },
  {
    id: 'landmark-moon-shrine',
    kind: 'moon_shrine',
    nameVi: '🌙 Đền Cổ Ánh Trăng',
    icon: '🌙',
    x: 0,
    z: -92,
    radius: 13,
    colorHex: 0xc792ff,
  },
  {
    id: 'landmark-dragon-colosseum',
    kind: 'dragon_colosseum',
    nameVi: '🐉 Đấu Trường Rồng Cổ Đại',
    icon: '🐉',
    x: 0,
    z: 92,
    radius: 14,
    colorHex: 0xff7043,
  },
];

interface ChapterThreshold {
  readonly chapter: number;
  readonly minWonders: number;
  readonly bonusScore: number;
  readonly titleVi: string;
}

const CHAPTER_THRESHOLDS: readonly ChapterThreshold[] = [
  { chapter: 1, minWonders: 2, bonusScore: 250, titleVi: 'Chương 1: Khởi Hành Thám Hiểm' },
  { chapter: 2, minWonders: 5, bonusScore: 400, titleVi: 'Chương 2: Dấu Chân Bốn Phương' },
  { chapter: 3, minWonders: 8, bonusScore: 600, titleVi: 'Chương 3: Hiệp Sĩ Kỳ Quan' },
  { chapter: 4, minWonders: 12, bonusScore: 1000, titleVi: 'Chương 4: Huyền Thoại Vương Quốc' },
];

const SHELTER_KIND_ICONS: Readonly<Record<ShelterKind, string>> = {
  castle: '🏰',
  mushroom: '🍄',
  crystal: '💎',
  mermaid: '🧜‍♀️',
  candy: '🍭',
  blossom: '🌸',
  starlight: '⭐',
};

/** Create a fresh copy of the 6 colossal landmarks, scaled proportionally with `worldRadius`. */
export function createInitialLandmarks(worldRadius?: number): WorldLandmark[] {
  if (!worldRadius || Math.abs(worldRadius - 280) < 1) {
    return DEFAULT_LANDMARKS.map((lm) => ({ ...lm }));
  }
  const scale = worldRadius / 280;
  return DEFAULT_LANDMARKS.map((lm) => ({
    ...lm,
    x: Math.round(lm.x * scale),
    z: Math.round(lm.z * scale),
    radius: Math.max(8, Math.round(lm.radius * Math.min(1.2, Math.max(0.7, scale)))),
  }));
}

/** Deterministically map any world coordinate `(x, z)` to one of the 7 kingdom regions. */
export function getRegionAt(pos: Vec2): AdventureRegion {
  const { x, z } = pos;
  if (Math.hypot(x, z) < 62) {
    return ADVENTURE_REGIONS.royal_citadel;
  }
  if (z <= -62 && Math.abs(x) <= 85) {
    return ADVENTURE_REGIONS.mushroom_woods;
  }
  if (x < -40 && z < -20) {
    return ADVENTURE_REGIONS.blossom_valley;
  }
  if (x > 40 && z < -20) {
    return ADVENTURE_REGIONS.candy_highlands;
  }
  if (x < -40 && z >= -20) {
    return ADVENTURE_REGIONS.mermaid_lagoon;
  }
  if (x > 40 && z >= 40) {
    return ADVENTURE_REGIONS.starlight_peaks;
  }
  return ADVENTURE_REGIONS.crystal_sanctum;
}

/** Return the deterministic climate specification for a given kingdom region ID. */
export function getClimateForRegion(regionId: AdventureRegionId): RegionClimate {
  return REGION_CLIMATES[regionId];
}

/** Deterministically map any world coordinate `(x, z)` to its local regional climate. */
export function getClimateAt(pos: Vec2): RegionClimate {
  return REGION_CLIMATES[getRegionAt(pos).id];
}

export interface NearestWonderTarget {
  readonly id: string;
  readonly nameVi: string;
  readonly icon: string;
  readonly x: number;
  readonly z: number;
  readonly distance: number;
  readonly isLandmark: boolean;
}

/** Find the closest undiscovered sanctuary palace or colossal landmark from `pos`. */
export function findNearestUndiscoveredWonder(
  pos: Vec2,
  state: Pick<
    GameState,
    'shelters' | 'discoveredShelterIds' | 'landmarks' | 'discoveredLandmarkIds'
  >,
): NearestWonderTarget | null {
  const shelters = state.shelters ?? [];
  const discoveredShelters = state.discoveredShelterIds ?? [];
  const landmarks = state.landmarks ?? [];
  const discoveredLandmarks = state.discoveredLandmarkIds ?? [];

  let best: NearestWonderTarget | null = null;
  let bestDist = Infinity;

  for (let i = 0; i < shelters.length; i++) {
    const s = shelters[i]!;
    if (discoveredShelters.includes(s.id)) continue;
    const d = Math.hypot(pos.x - s.x, pos.z - s.z);
    if (d < bestDist) {
      bestDist = d;
      best = {
        id: s.id,
        nameVi: s.nameVi,
        icon: SHELTER_KIND_ICONS[s.kind],
        x: s.x,
        z: s.z,
        distance: d,
        isLandmark: false,
      };
    }
  }

  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i]!;
    if (discoveredLandmarks.includes(lm.id)) continue;
    const d = Math.hypot(pos.x - lm.x, pos.z - lm.z);
    if (d < bestDist) {
      bestDist = d;
      best = {
        id: lm.id,
        nameVi: lm.nameVi,
        icon: lm.icon,
        x: lm.x,
        z: lm.z,
        distance: d,
        isLandmark: true,
      };
    }
  }

  return best;
}

function computeTargetChapter(totalWonders: number): number {
  let ch = 0;
  for (let i = 0; i < CHAPTER_THRESHOLDS.length; i++) {
    const spec = CHAPTER_THRESHOLDS[i]!;
    if (totalWonders >= spec.minWonders) {
      ch = spec.chapter;
    }
  }
  return ch;
}

/**
 * Pure per-tick adventure check (NEVER touches `state.rng`):
 * - Tracks current biome region and emits `region_discovered` (no score/XP) on first visit.
 * - Discovers colossal landmarks within `lm.radius` (+200 score, +12 XP, full dash, +25 butterfly).
 * - Advances `adventureChapter` across 2 / 5 / 8 / 12 total wonders with bonus score & XP.
 */
export function stepAdventure(state: GameState): GameState {
  const head = state.snake[0];
  if (head === undefined) return state;

  const landmarks = state.landmarks ?? DEFAULT_LANDMARKS;
  const prevDiscoveredLandmarks = state.discoveredLandmarkIds ?? [];
  const discoveredShelters = state.discoveredShelterIds ?? [];
  const prevVisitedRegions = state.visitedRegionIds ?? ['royal_citadel'];
  const prevRegionId = state.currentRegionId ?? 'royal_citadel';
  const prevChapter = state.adventureChapter ?? 0;

  const region = getRegionAt(head);
  const nextRegionId = region.id;
  const isNewRegion = !prevVisitedRegions.includes(nextRegionId);

  let newlyDiscoveredLandmarks: WorldLandmark[] | null = null;
  for (let i = 0; i < landmarks.length; i++) {
    const lm = landmarks[i]!;
    if (prevDiscoveredLandmarks.includes(lm.id)) continue;
    const dx = head.x - lm.x;
    const dz = head.z - lm.z;
    if (dx * dx + dz * dz <= lm.radius * lm.radius) {
      if (newlyDiscoveredLandmarks === null) newlyDiscoveredLandmarks = [lm];
      else newlyDiscoveredLandmarks.push(lm);
    }
  }

  const nextLandmarkCount =
    prevDiscoveredLandmarks.length +
    (newlyDiscoveredLandmarks ? newlyDiscoveredLandmarks.length : 0);
  const totalWonders = discoveredShelters.length + nextLandmarkCount;
  const targetChapter = Math.max(prevChapter, computeTargetChapter(totalWonders));

  // Fast path: zero allocations when staying in an already-visited region with no new wonders/chapters.
  if (
    !isNewRegion &&
    nextRegionId === prevRegionId &&
    newlyDiscoveredLandmarks === null &&
    targetChapter === prevChapter
  ) {
    return state;
  }

  let events = state.events;
  let eventSeq = state.eventSeq;
  let score = state.score;
  let best = state.best;
  let level = state.level;
  let xp = state.xp;
  let dashEnergy = state.dashEnergy;
  let butterflyCharge = state.butterflyCharge;

  const visitedRegionIds = isNewRegion ? [...prevVisitedRegions, nextRegionId] : prevVisitedRegions;
  if (isNewRegion) {
    const regionEv: EventDraft = {
      kind: 'region_discovered',
      regionId: nextRegionId,
      cell: head,
      messageVi: `🗺️ Khám phá vùng đất mới: ${region.nameVi}! ✨`,
    };
    const appended = appendEvents(events, eventSeq, [regionEv]);
    events = appended.events;
    eventSeq = appended.eventSeq;
  }

  let discoveredLandmarkIds = prevDiscoveredLandmarks;
  if (newlyDiscoveredLandmarks !== null) {
    const addedIds: string[] = [];
    for (const lm of newlyDiscoveredLandmarks) {
      addedIds.push(lm.id);
      const lmDraft: EventDraft = {
        kind: 'landmark_discovered',
        landmarkId: lm.id,
        points: LANDMARK_DISCOVERY_SCORE,
        cell: head,
        messageVi: `✨ KHÁM PHÁ KỲ QUAN: ${lm.nameVi}! (+${LANDMARK_DISCOVERY_SCORE}đ) 🌟`,
      };
      const appended = appendEvents(events, eventSeq, [lmDraft]);
      const xpRes = applyXpAndScore({
        score,
        best,
        level,
        xp,
        gainXp: LANDMARK_DISCOVERY_XP,
        points: LANDMARK_DISCOVERY_SCORE,
        events: appended.events,
        eventSeq: appended.eventSeq,
        cell: head,
      });
      score = xpRes.score;
      best = xpRes.best;
      level = xpRes.level;
      xp = xpRes.xp;
      events = xpRes.events;
      eventSeq = xpRes.eventSeq;
      dashEnergy = 100;
      butterflyCharge = Math.min(100, butterflyCharge + LANDMARK_BUTTERFLY_CHARGE_BONUS);
    }
    discoveredLandmarkIds = [...prevDiscoveredLandmarks, ...addedIds];
  }

  if (targetChapter > prevChapter) {
    for (let i = 0; i < CHAPTER_THRESHOLDS.length; i++) {
      const spec = CHAPTER_THRESHOLDS[i]!;
      if (spec.chapter <= prevChapter || spec.chapter > targetChapter) continue;
      const chDraft: EventDraft = {
        kind: 'chapter_complete',
        chapter: spec.chapter,
        points: spec.bonusScore,
        cell: head,
        messageVi: `👑 Hoàn thành ${spec.titleVi}! (+${spec.bonusScore}đ) 🏆`,
      };
      const appended = appendEvents(events, eventSeq, [chDraft]);
      const xpRes = applyXpAndScore({
        score,
        best,
        level,
        xp,
        gainXp: CHAPTER_XP_REWARD,
        points: spec.bonusScore,
        events: appended.events,
        eventSeq: appended.eventSeq,
        cell: head,
      });
      score = xpRes.score;
      best = xpRes.best;
      level = xpRes.level;
      xp = xpRes.xp;
      events = xpRes.events;
      eventSeq = xpRes.eventSeq;
    }
  }

  let leaderboard = state.leaderboard;
  let playerRank = state.playerRank;
  let crownTarget = state.crownTarget;
  if (level !== state.level) {
    const board = computeLeaderboard({
      playerName: state.playerName,
      playerLevel: level,
      bots: state.bots,
      activeBossId: state.activeBossId,
    });
    leaderboard = board.leaderboard;
    playerRank = board.playerRank;
    crownTarget = board.crownTarget;
  }

  return {
    ...state,
    discoveredLandmarkIds,
    visitedRegionIds,
    currentRegionId: nextRegionId,
    adventureChapter: targetChapter,
    score,
    best,
    level,
    xp,
    dashEnergy,
    butterflyCharge,
    leaderboard,
    playerRank,
    crownTarget,
    events,
    eventSeq,
  };
}
