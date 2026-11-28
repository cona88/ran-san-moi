/**
 * "Thế Giới Nội Thất Lâu Đài Xa Hoa" — Interactive Castle Interior World & Royal Wardrobe.
 *
 * Pure, deterministic, zero-RNG palace hall exploration, 7 signature royal luxury sets
 * (outfits, makeup & crowns, signature weapons), pedestal auto-try-on, and exit portal.
 */
import { computeLeaderboard } from './bots';
import { buildStraightSpine, targetPlayerLength } from './movement';
import { appendEvents, applyXpAndScore, type EventDraft } from './quests';
import { angleDiff, angleToDirection, clamp, normalizeAngle } from './systems/arena';
import type {
  CastleCosmeticSlot,
  CastleInteriorState,
  CastleInteriorZone,
  CastleRoyalSet,
  GameState,
  RoyalWardrobeState,
  ShelterHouse,
  ShelterKind,
  Vec2,
} from './types';

export const CASTLE_FIRST_VISIT_SCORE = 150;
export const CASTLE_FIRST_VISIT_XP = 10;
export const INTERIOR_WALK_SPEED = 0.42;
export const INTERIOR_DASH_SPEED = 0.72;
export const INTERIOR_TURN_RATE = 0.24;
export const PEDESTAL_AUTO_EQUIP_RADIUS = 2.8;
export const EXIT_GATE_RADIUS = 2.6;
export const FURNITURE_ZONE_RADIUS = 4.2;

export const INTERIOR_BOUNDS = { halfW: 20, halfD: 23 } as const;

export const INTERIOR_SPOTS = {
  exitGate: { x: 0, z: 21.5 },
  outfitPedestal: { x: -9, z: -12.5 },
  makeupPedestal: { x: 0, z: -11 },
  weaponPedestal: { x: 9, z: -12.5 },
  throne: { x: 0, z: -19.5 },
  vanity: { x: -13.5, z: -5.5 },
  banquet: { x: 13.5, z: -5.5 },
} as const;

export const CASTLE_ROYAL_SETS: Readonly<Record<ShelterKind, CastleRoyalSet>> = {
  castle: {
    kind: 'castle',
    themeTitleVi: '🏰 Hoàng Cung Ánh Vàng Hoàng Gia',
    interiorSubtitleVi: 'Đại Sảnh Đèn Chùm Pha Lê • Ngai Vàng Hồng Ngọc & Bàn Tiệc Hoàng Tộc',
    outfitNameVi: 'Đầm Hoàng Hậu Ánh Vàng',
    outfitEmoji: '👗',
    gownPrimaryHex: 0xe63963,
    gownSecondaryHex: 0xffd166,
    gownGoldHex: 0xffe066,
    makeupNameVi: 'Trang Điểm Kim Cương Đỏ & Vương Miện Vàng',
    makeupEmoji: '👑',
    hairHex: 0xf7c948,
    hairHighlightHex: 0xfff3b0,
    irisHex: 0xd90429,
    blushHex: 0xff758f,
    lipHex: 0xe63946,
    crownHex: 0xffd700,
    crownGemHex: 0xff2a55,
    weaponKind: 'royal_sword',
    weaponNameVi: 'Thánh Kiếm Ánh Sao',
    weaponEmoji: '⚔️',
    weaponPrimaryHex: 0xffd700,
    weaponAccentHex: 0xff4d6d,
  },
  mermaid: {
    kind: 'mermaid',
    themeTitleVi: '🧜‍♀️ Cung Điện Ngọc Trai Đại Dương',
    interiorSubtitleVi: 'Ngai Vỏ Sò Khổng Lồ • Đàn Cá & Sứa Phát Sáng Bơi Lội Lung Linh',
    outfitNameVi: 'Váy Ngọc Trai Tiên Cá',
    outfitEmoji: '🧜‍♀️',
    gownPrimaryHex: 0x38f6ff,
    gownSecondaryHex: 0xb388ff,
    gownGoldHex: 0x9efaff,
    makeupNameVi: 'Nhũ Mắt Đại Dương & Vương Miện Vỏ Sò',
    makeupEmoji: '🐚',
    hairHex: 0x48cae4,
    hairHighlightHex: 0xcaf0f8,
    irisHex: 0x00b4d8,
    blushHex: 0xff8fab,
    lipHex: 0xff5d8f,
    crownHex: 0x90e0ef,
    crownGemHex: 0xff80cc,
    weaponKind: 'ocean_trident',
    weaponNameVi: 'Đinh Ba Hải Vương Pha Lê',
    weaponEmoji: '🔱',
    weaponPrimaryHex: 0x00e5ff,
    weaponAccentHex: 0xff80cc,
  },
  candy: {
    kind: 'candy',
    themeTitleVi: '🍭 Lâu Đài Kẹo Ngọt Cầu Vồng',
    interiorSubtitleVi: 'Cột Kẹo Bạc Hà • Vòng Quay Bánh Macaron & Đài Phun Sô-Cô-La',
    outfitNameVi: 'Váy Kem Dâu Macaron',
    outfitEmoji: '🧁',
    gownPrimaryHex: 0xff75c3,
    gownSecondaryHex: 0x7ef8d8,
    gownGoldHex: 0xffe066,
    makeupNameVi: 'Má Hồng Kẹo Bông & Vương Miện Kẹo Ngọt',
    makeupEmoji: '🍬',
    hairHex: 0xff85c0,
    hairHighlightHex: 0xffe5f1,
    irisHex: 0xff477e,
    blushHex: 0xff70a6,
    lipHex: 0xff4d8d,
    crownHex: 0xff9ebb,
    crownGemHex: 0x7ef8ff,
    weaponKind: 'candy_scepter',
    weaponNameVi: 'Quyền Trượng Kẹo Mút Cầu Vồng',
    weaponEmoji: '🍭',
    weaponPrimaryHex: 0xff69b4,
    weaponAccentHex: 0x7ef8ff,
  },
  blossom: {
    kind: 'blossom',
    themeTitleVi: '🌸 Cung Điện Hoa Anh Đào Mùa Xuân',
    interiorSubtitleVi: 'Vườn Anh Đào Nở Rộ Trong Điện • Hồ Sen Ngọc & Cánh Hoa Bay',
    outfitNameVi: 'Áo Hoa Anh Đào Mùa Xuân',
    outfitEmoji: '🌸',
    gownPrimaryHex: 0xff9ec7,
    gownSecondaryHex: 0xffe3f1,
    gownGoldHex: 0xffd166,
    makeupNameVi: 'Phấn Hoa Anh Đào & Vòng Hoa Tiên Bướm',
    makeupEmoji: '🌺',
    hairHex: 0xffb3c6,
    hairHighlightHex: 0xfff0f5,
    irisHex: 0xe05780,
    blushHex: 0xff8fab,
    lipHex: 0xf25c78,
    crownHex: 0xffc2d1,
    crownGemHex: 0xffe066,
    weaponKind: 'sakura_staff',
    weaponNameVi: 'Trượng Hoa Anh Đào Nở Rộ',
    weaponEmoji: '🪄',
    weaponPrimaryHex: 0xff85c0,
    weaponAccentHex: 0xfff3b0,
  },
  crystal: {
    kind: 'crystal',
    themeTitleVi: '💎 Thánh Điện Nữ Hoàng Băng Pha Lê',
    interiorSubtitleVi: 'Cột Kim Cương Lấp Lánh • Sàn Gương Lam Ngọc & Đàn Hạc Băng Tinh',
    outfitNameVi: 'Lễ Phục Nữ Hoàng Băng Giá',
    outfitEmoji: '❄️',
    gownPrimaryHex: 0x72efdd,
    gownSecondaryHex: 0xdffcff,
    gownGoldHex: 0xb8f9ff,
    makeupNameVi: 'Nhũ Băng Tuyết & Vương Miện Bông Tuyết',
    makeupEmoji: '💎',
    hairHex: 0xcaf0f8,
    hairHighlightHex: 0xffffff,
    irisHex: 0x00bbf9,
    blushHex: 0xff99c8,
    lipHex: 0xe0569c,
    crownHex: 0xade8f4,
    crownGemHex: 0xffffff,
    weaponKind: 'crystal_bow',
    weaponNameVi: 'Cung Tên Băng Tinh Pha Lê',
    weaponEmoji: '🏹',
    weaponPrimaryHex: 0x56cfe1,
    weaponAccentHex: 0xffffff,
  },
  starlight: {
    kind: 'starlight',
    themeTitleVi: '⭐ Cung Điện Tinh Vân Ánh Sao',
    interiorSubtitleVi: 'Sàn Ngân Hà Đêm Huyền Diệu • Cột Hoàng Đạo & Mô Hình Tinh Cầu Vàng',
    outfitNameVi: 'Váy Dạ Hội Tinh Vân Tím',
    outfitEmoji: '🌌',
    gownPrimaryHex: 0x9d4edd,
    gownSecondaryHex: 0x5a189a,
    gownGoldHex: 0xffe066,
    makeupNameVi: 'Nhũ Sao Đêm & Vương Miện Trăng Khuyết',
    makeupEmoji: '🌙',
    hairHex: 0xc77dff,
    hairHighlightHex: 0xf3d9fa,
    irisHex: 0x7b2cbf,
    blushHex: 0xff85c0,
    lipHex: 0xd63384,
    crownHex: 0xffe066,
    crownGemHex: 0xc77dff,
    weaponKind: 'starlight_wand',
    weaponNameVi: 'Quyền Trượng Trăng Sao Ngân Hà',
    weaponEmoji: '🌟',
    weaponPrimaryHex: 0xc77dff,
    weaponAccentHex: 0xffe066,
  },
  mushroom: {
    kind: 'mushroom',
    themeTitleVi: '🍄 Cung Điện Tinh Linh Rừng Ngọc',
    interiorSubtitleVi: 'Cột Nấm Phát Quang Khổng Lồ • Đèn Đom Đóm & Suối Sương Mai',
    outfitNameVi: 'Váy Tinh Linh Ngọc Lục Bảo',
    outfitEmoji: '🧚‍♀️',
    gownPrimaryHex: 0x52b788,
    gownSecondaryHex: 0x95d5b2,
    gownGoldHex: 0xffd166,
    makeupNameVi: 'Phấn Tiên Rừng Xanh & Vương Miện Ngọc Rừng',
    makeupEmoji: '🍃',
    hairHex: 0xe9c46a,
    hairHighlightHex: 0xfefae0,
    irisHex: 0x2d6a4f,
    blushHex: 0xff8fab,
    lipHex: 0xe76f51,
    crownHex: 0xffd166,
    crownGemHex: 0x52b788,
    weaponKind: 'pixie_wand',
    weaponNameVi: 'Đũa Thần Bụi Tiên Cổ Thụ',
    weaponEmoji: '✨',
    weaponPrimaryHex: 0x7be856,
    weaponAccentHex: 0xffe066,
  },
};

/** Create an empty initial Royal Wardrobe state. */
export function createInitialWardrobe(): RoyalWardrobeState {
  return {
    equippedOutfit: null,
    equippedMakeup: null,
    equippedWeapon: null,
    unlockedKinds: [],
    visitedInteriorIds: [],
  };
}

/** Determine which interactive palace pedestal, furnishing, or portal `pos` is standing near. */
export function detectInteriorZone(pos: Vec2): CastleInteriorZone | null {
  if (
    Math.hypot(pos.x - INTERIOR_SPOTS.outfitPedestal.x, pos.z - INTERIOR_SPOTS.outfitPedestal.z) <=
    PEDESTAL_AUTO_EQUIP_RADIUS
  ) {
    return 'outfit';
  }
  if (
    Math.hypot(pos.x - INTERIOR_SPOTS.makeupPedestal.x, pos.z - INTERIOR_SPOTS.makeupPedestal.z) <=
    PEDESTAL_AUTO_EQUIP_RADIUS
  ) {
    return 'makeup';
  }
  if (
    Math.hypot(pos.x - INTERIOR_SPOTS.weaponPedestal.x, pos.z - INTERIOR_SPOTS.weaponPedestal.z) <=
    PEDESTAL_AUTO_EQUIP_RADIUS
  ) {
    return 'weapon';
  }
  if (
    Math.hypot(pos.x - INTERIOR_SPOTS.exitGate.x, pos.z - INTERIOR_SPOTS.exitGate.z) <=
    EXIT_GATE_RADIUS
  ) {
    return 'exit';
  }
  if (
    Math.hypot(pos.x - INTERIOR_SPOTS.throne.x, pos.z - INTERIOR_SPOTS.throne.z) <=
    FURNITURE_ZONE_RADIUS
  ) {
    return 'throne';
  }
  if (
    Math.hypot(pos.x - INTERIOR_SPOTS.vanity.x, pos.z - INTERIOR_SPOTS.vanity.z) <=
    FURNITURE_ZONE_RADIUS
  ) {
    return 'vanity';
  }
  if (
    Math.hypot(pos.x - INTERIOR_SPOTS.banquet.x, pos.z - INTERIOR_SPOTS.banquet.z) <=
    FURNITURE_ZONE_RADIUS
  ) {
    return 'banquet';
  }
  return null;
}

function resolveTargetShelter(state: GameState, shelterId?: string): ShelterHouse | null {
  if (shelterId !== undefined) {
    return state.shelters.find((s) => s.id === shelterId) ?? null;
  }
  if (state.inShelter && state.currentShelterId !== null) {
    const active = state.shelters.find((s) => s.id === state.currentShelterId);
    if (active) return active;
  }
  const head = state.snake[0];
  if (!head) return null;
  let best: ShelterHouse | null = null;
  let bestDist = Infinity;
  for (let i = 0; i < state.shelters.length; i++) {
    const s = state.shelters[i]!;
    const d = Math.hypot(head.x - s.x, head.z - s.z);
    if (d <= s.radius + 3 && d < bestDist) {
      bestDist = d;
      best = s;
    }
  }
  return best;
}

function itemLabelForSlot(slot: CastleCosmeticSlot, set: CastleRoyalSet): string {
  switch (slot) {
    case 'outfit':
      return `${set.outfitEmoji} ${set.outfitNameVi}`;
    case 'makeup':
      return `${set.makeupEmoji} ${set.makeupNameVi}`;
    case 'weapon':
      return `${set.weaponEmoji} ${set.weaponNameVi}`;
  }
}

function setWardrobeSlot(
  wardrobe: RoyalWardrobeState,
  slot: CastleCosmeticSlot,
  kind: ShelterKind | null,
): RoyalWardrobeState {
  switch (slot) {
    case 'outfit':
      return { ...wardrobe, equippedOutfit: kind };
    case 'makeup':
      return { ...wardrobe, equippedMakeup: kind };
    case 'weapon':
      return { ...wardrobe, equippedWeapon: kind };
  }
}

function getWardrobeSlot(
  wardrobe: RoyalWardrobeState,
  slot: CastleCosmeticSlot,
): ShelterKind | null {
  switch (slot) {
    case 'outfit':
      return wardrobe.equippedOutfit;
    case 'makeup':
      return wardrobe.equippedMakeup;
    case 'weapon':
      return wardrobe.equippedWeapon;
  }
}

/** Enter the opulent 3D Castle Interior of `shelterId` (or the player's current shelter). */
export function enterCastle(state: GameState, shelterId?: string): GameState {
  if (state.phase !== 'playing' || state.castleInterior !== null) {
    return state;
  }
  const shelter = resolveTargetShelter(state, shelterId);
  if (!shelter) return state;

  const prevWardrobe = state.wardrobe ?? createInitialWardrobe();
  const firstVisit = !prevWardrobe.visitedInteriorIds.includes(shelter.id);
  const visitedInteriorIds = firstVisit
    ? [...prevWardrobe.visitedInteriorIds, shelter.id]
    : prevWardrobe.visitedInteriorIds;
  const unlockedKinds = prevWardrobe.unlockedKinds.includes(shelter.kind)
    ? prevWardrobe.unlockedKinds
    : [...prevWardrobe.unlockedKinds, shelter.kind];

  const nextWardrobe: RoyalWardrobeState = {
    ...prevWardrobe,
    visitedInteriorIds,
    unlockedKinds,
  };

  const spawnPos: Vec2 = { x: 0, z: 16 };
  const castleInterior: CastleInteriorState = {
    shelterId: shelter.id,
    shelterKind: shelter.kind,
    shelterNameVi: shelter.nameVi,
    accentHex: shelter.colorHex,
    pos: spawnPos,
    prevPos: spawnPos,
    heading: -Math.PI / 2,
    targetHeading: null,
    isDashing: false,
    nearZone: null,
    ticksInside: 0,
  };

  const setMeta = CASTLE_ROYAL_SETS[shelter.kind];
  const enterDraft: EventDraft = {
    kind: 'castle_enter_interior',
    shelterId: shelter.id,
    shelterKind: shelter.kind,
    ...(firstVisit ? { points: CASTLE_FIRST_VISIT_SCORE } : {}),
    cell: { x: shelter.x, z: shelter.z },
    messageVi: firstVisit
      ? `🏰 Chào mừng vào ${setMeta.themeTitleVi}! Mở khóa tủ đồ Hoàng Gia (+${CASTLE_FIRST_VISIT_SCORE}đ) ✨`
      : `🏰 Chào mừng trở lại ${setMeta.themeTitleVi}! ✨`,
  };

  const appended = appendEvents([], state.eventSeq, [enterDraft]);
  let events = appended.events;
  let eventSeq = appended.eventSeq;
  let score = state.score;
  let best = state.best;
  let level = state.level;
  let xp = state.xp;
  let leaderboard = state.leaderboard;
  let playerRank = state.playerRank;
  let crownTarget = state.crownTarget;

  if (firstVisit) {
    const xpRes = applyXpAndScore({
      score,
      best,
      level,
      xp,
      gainXp: CASTLE_FIRST_VISIT_XP,
      points: CASTLE_FIRST_VISIT_SCORE,
      events,
      eventSeq,
      cell: { x: shelter.x, z: shelter.z },
    });
    score = xpRes.score;
    best = xpRes.best;
    level = xpRes.level;
    xp = xpRes.xp;
    events = xpRes.events;
    eventSeq = xpRes.eventSeq;

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
  }

  return {
    ...state,
    isDashing: false,
    targetHeading: null,
    castleInterior,
    wardrobe: nextWardrobe,
    score,
    best,
    level,
    xp,
    leaderboard,
    playerRank,
    crownTarget,
    events,
    eventSeq,
  };
}

/** Exit the Castle Interior back into the outer shelter dome, preserving all equipped cosmetics. */
export function exitCastle(state: GameState): GameState {
  const ci = state.castleInterior;
  if (ci === null) return state;

  const shelter = state.shelters.find((s) => s.id === ci.shelterId);
  const exitHead: Vec2 = shelter
    ? { x: shelter.x, z: shelter.z + shelter.radius * 0.4 }
    : (state.snake[0] ?? { x: 0, z: 6 });
  const exitHeading = Math.PI / 2;
  const targetLen = Math.max(
    state.snake.length,
    targetPlayerLength(state.level, state.config.initialLength),
  );
  const nextSnake = buildStraightSpine(exitHead, exitHeading, targetLen);
  const prevSnake = nextSnake.map((p) => ({ ...p }));

  const ev = appendEvents([], state.eventSeq, [
    {
      kind: 'castle_exit_interior',
      shelterId: ci.shelterId,
      shelterKind: ci.shelterKind,
      cell: exitHead,
      messageVi: `🚪 Rời khỏi ${ci.shelterNameVi} • Chúc bé phiêu lưu vui vẻ! ✨`,
    },
  ]);

  return {
    ...state,
    castleInterior: null,
    snake: nextSnake,
    prevSnake,
    heading: exitHeading,
    direction: angleToDirection(exitHeading),
    targetHeading: null,
    queue: [],
    isDashing: false,
    inShelter: shelter !== undefined,
    currentShelterId: shelter ? shelter.id : null,
    shelteredTicks: 0,
    invulnerableTicks: Math.max(state.invulnerableTicks, 30),
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

/** Equip (or unequip with `null`) an unlocked royal outfit, makeup/crown, or signature weapon. */
export function equipCastleItem(
  state: GameState,
  slot: CastleCosmeticSlot,
  kind: ShelterKind | null,
): GameState {
  if (state.phase !== 'playing') return state;

  const prevWardrobe = state.wardrobe ?? createInitialWardrobe();
  const allowed =
    kind === null ||
    prevWardrobe.unlockedKinds.includes(kind) ||
    state.castleInterior?.shelterKind === kind;
  if (!allowed) return state;

  const unlockedKinds =
    kind !== null && !prevWardrobe.unlockedKinds.includes(kind)
      ? [...prevWardrobe.unlockedKinds, kind]
      : prevWardrobe.unlockedKinds;
  const updatedWardrobe = setWardrobeSlot({ ...prevWardrobe, unlockedKinds }, slot, kind);

  const label =
    kind === null ? 'Trang phục Tiên Mặc Định' : itemLabelForSlot(slot, CASTLE_ROYAL_SETS[kind]);
  const ev = appendEvents([], state.eventSeq, [
    {
      kind: 'castle_item_equipped',
      cosmeticSlot: slot,
      ...(kind !== null ? { shelterKind: kind } : {}),
      cell: state.snake[0],
      messageVi: `✨ Đã trang bị: ${label}! 💖`,
    },
  ]);

  return {
    ...state,
    wardrobe: updatedWardrobe,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

/** Update smooth 360° steering while strolling inside a Castle Interior. */
export function steerCastleInterior(state: GameState, angle: number | null): GameState {
  const ci = state.castleInterior;
  if (!ci) return state;
  if (angle === null || !Number.isFinite(angle)) {
    return ci.targetHeading === null && (ci.walkTicks ?? 0) === 0 && state.events.length === 0
      ? state
      : {
          ...state,
          castleInterior: { ...ci, targetHeading: null, walkTicks: 0 },
          events: [],
        };
  }
  const norm = normalizeAngle(angle);
  return {
    ...state,
    castleInterior: { ...ci, targetHeading: norm, walkTicks: 0 },
    events: [],
  };
}

/** Nudge movement in a cardinal direction while inside a Castle Interior. */
export function turnCastleInterior(state: GameState, angle: number): GameState {
  const ci = state.castleInterior;
  if (!ci) return state;
  return {
    ...state,
    castleInterior: { ...ci, targetHeading: normalizeAngle(angle), walkTicks: 8 },
    events: [],
  };
}

/** Toggle palace sprint/glide while inside a Castle Interior. */
export function dashCastleInterior(state: GameState, active: boolean): GameState {
  const ci = state.castleInterior;
  if (!ci) return state;
  if (ci.isDashing === active && state.events.length === 0) return state;
  return {
    ...state,
    castleInterior: { ...ci, isDashing: active },
    events: [],
  };
}

/**
 * Advance ONLY the Castle Interior world by 1 tick while keeping outer-world timers,
 * bots, hostile projectiles, and monster events completely frozen (zero RNG usage).
 */
export function stepCastleInterior(state: GameState): GameState {
  const ci = state.castleInterior;
  if (ci === null) return state;

  const ticksInside = ci.ticksInside + 1;
  let nextHeading = ci.heading;
  let nextPos = ci.pos;
  const prevPos = ci.pos;
  let nextTargetHeading = ci.targetHeading;
  let nextWalkTicks = ci.walkTicks ?? 0;

  if (nextTargetHeading !== null) {
    const diff = angleDiff(ci.heading, nextTargetHeading);
    nextHeading = normalizeAngle(ci.heading + clamp(diff, -INTERIOR_TURN_RATE, INTERIOR_TURN_RATE));
    const speed = ci.isDashing ? INTERIOR_DASH_SPEED : INTERIOR_WALK_SPEED;
    nextPos = {
      x: clamp(
        ci.pos.x + Math.cos(nextHeading) * speed,
        -INTERIOR_BOUNDS.halfW,
        INTERIOR_BOUNDS.halfW,
      ),
      z: clamp(
        ci.pos.z + Math.sin(nextHeading) * speed,
        -INTERIOR_BOUNDS.halfD,
        INTERIOR_BOUNDS.halfD,
      ),
    };
    if (nextWalkTicks > 0) {
      nextWalkTicks -= 1;
      if (nextWalkTicks === 0) {
        nextTargetHeading = null;
      }
    }
  }

  // Stepping onto the Exit Portal Archway after >= 20 ticks while walking toward +Z exits cleanly
  if (
    ticksInside >= 20 &&
    nextPos.z > prevPos.z &&
    Math.hypot(nextPos.x - INTERIOR_SPOTS.exitGate.x, nextPos.z - INTERIOR_SPOTS.exitGate.z) <=
      EXIT_GATE_RADIUS
  ) {
    return exitCastle({
      ...state,
      castleInterior: {
        ...ci,
        pos: nextPos,
        prevPos,
        heading: nextHeading,
        targetHeading: nextTargetHeading,
        walkTicks: nextWalkTicks,
        ticksInside,
      },
    });
  }

  const nearZone = detectInteriorZone(nextPos);
  const drafts: EventDraft[] = [];
  let wardrobe = state.wardrobe ?? createInitialWardrobe();
  let hearts = state.hearts;

  // Palace heart regeneration: +1 heart every 20 ticks inside up to maxHearts
  if (ticksInside % 20 === 0 && hearts < state.maxHearts) {
    hearts += 1;
    drafts.push({
      kind: 'heart_gained',
      cell: state.snake[0],
    });
  }

  // Pedestal auto-try-on when newly stepping onto outfit / makeup / weapon display
  if (
    (nearZone === 'outfit' || nearZone === 'makeup' || nearZone === 'weapon') &&
    ci.nearZone !== nearZone
  ) {
    if (getWardrobeSlot(wardrobe, nearZone) !== ci.shelterKind) {
      const unlockedKinds = wardrobe.unlockedKinds.includes(ci.shelterKind)
        ? wardrobe.unlockedKinds
        : [...wardrobe.unlockedKinds, ci.shelterKind];
      wardrobe = setWardrobeSlot({ ...wardrobe, unlockedKinds }, nearZone, ci.shelterKind);
      const label = itemLabelForSlot(nearZone, CASTLE_ROYAL_SETS[ci.shelterKind]);
      drafts.push({
        kind: 'castle_item_equipped',
        cosmeticSlot: nearZone,
        shelterKind: ci.shelterKind,
        cell: state.snake[0],
        messageVi: `✨ Đã mặc thử từ bục trưng bày: ${label}! 💖`,
      });
    }
  }

  const ev = appendEvents([], state.eventSeq, drafts);

  return {
    ...state,
    hearts,
    wardrobe,
    castleInterior: {
      ...ci,
      pos: nextPos,
      prevPos,
      heading: nextHeading,
      targetHeading: nextTargetHeading,
      walkTicks: nextWalkTicks,
      nearZone,
      ticksInside,
    },
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}
