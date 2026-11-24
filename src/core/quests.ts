import {
  SNAKE_FORMS,
  type BoosterKind,
  type BoostersState,
  type BrainQuest,
  type Cell,
  type GameEvent,
  type GameEventKind,
  type GameState,
  type QuestKind,
  type QuestOrb,
  type QuestRewardEffect,
  type RngState,
  type SnakeForm,
  type Vec2,
} from './types';
import { FORM_METADATA } from './config';
import { nextFloat, nextInt } from './rng';
import { clamp } from './systems/arena';
import { scatterLootOrbs } from './systems/food';
import {
  triggerButterflyMetamorphosisInstant,
  spawnFlowerRing,
  spawnThunderStorm,
  spawnFireNova,
  spawnWaterTsunami,
  spawnArcaneNova,
} from './fairyMagic';

import type { BotMagicKind } from './types';

export interface EventDraft {
  readonly kind: GameEventKind;
  readonly cell?: Cell;
  readonly form?: SnakeForm;
  readonly points?: number;
  readonly chompStreak?: number;
  readonly messageVi?: string;
  readonly shelterId?: string;
  readonly spell?: BotMagicKind;
}

const BOOSTER_ORDER: readonly BoosterKind[] = ['level', 'speed', 'magnet'];

/** XP required to advance from `level` to `level + 1` (smooth fast early curve). */
export function xpThresholdForLevel(level: number): number {
  return 8 + Math.floor(Math.max(1, level) * 1.4);
}

/** Legacy helper kept for compatibility: maps score to tier. */
export function computeLevel(score: number): number {
  return 1 + Math.floor(Math.max(0, score) / 100);
}

/** Materialize event drafts into concrete {@link GameEvent} objects with sequential IDs. */
export function appendEvents(
  existingEvents: readonly GameEvent[],
  startSeq: number,
  drafts: readonly EventDraft[],
): { events: readonly GameEvent[]; eventSeq: number } {
  if (drafts.length === 0) {
    return { events: existingEvents, eventSeq: startSeq };
  }
  let seq = startSeq;
  const appended: GameEvent[] = [];
  for (const d of drafts) {
    seq += 1;
    appended.push({ id: seq, ...d });
  }
  return { events: [...existingEvents, ...appended], eventSeq: seq };
}

/** Grant +1 charge (up to max 3) to a non-full booster slot. */
export function grantBoosterCharge(
  boosters: BoostersState,
  preferredOffset = 0,
): { boosters: BoostersState; granted: BoosterKind | null } {
  let chosen: BoosterKind | null = null;
  let lowestCharges = 3;

  for (let i = 0; i < BOOSTER_ORDER.length; i++) {
    const kind = BOOSTER_ORDER[(preferredOffset + i) % BOOSTER_ORDER.length]!;
    const slot = boosters[kind];
    if (slot.charges < lowestCharges) {
      lowestCharges = slot.charges;
      chosen = kind;
    }
  }

  if (chosen === null) {
    return { boosters, granted: null };
  }

  const prevSlot = boosters[chosen];
  return {
    boosters: {
      ...boosters,
      [chosen]: { ...prevSlot, charges: Math.min(3, prevSlot.charges + 1) },
    },
    granted: chosen,
  };
}

/** Apply XP, score, and best-score gains and emit `level_up` when crossing thresholds. */
export function applyXpAndScore(params: {
  readonly score: number;
  readonly best: number;
  readonly level: number;
  readonly xp: number;
  readonly gainXp: number;
  readonly points: number;
  readonly events: readonly GameEvent[];
  readonly eventSeq: number;
  readonly cell?: Vec2;
}): {
  readonly score: number;
  readonly best: number;
  readonly level: number;
  readonly xp: number;
  readonly events: readonly GameEvent[];
  readonly eventSeq: number;
} {
  const score = params.score + params.points;
  const best = Math.max(params.best, score);
  let level = params.level;
  let xp = params.xp + Math.max(0, params.gainXp);

  while (xp >= xpThresholdForLevel(level)) {
    xp -= xpThresholdForLevel(level);
    level += 1;
  }

  if (level > params.level) {
    const ev = appendEvents(params.events, params.eventSeq, [
      {
        kind: 'level_up',
        cell: params.cell,
        messageVi: `Chúc mừng! Bé lên Cấp ${level}! 🎉`,
      },
    ]);
    return { score, best, level, xp, events: ev.events, eventSeq: ev.eventSeq };
  }

  return {
    score,
    best,
    level,
    xp,
    events: params.events,
    eventSeq: params.eventSeq,
  };
}

/** Add points to score & best while preserving the current progression level. */
export function applyScoreGain(params: {
  readonly score: number;
  readonly best: number;
  readonly level: number;
  readonly points: number;
  readonly events: readonly GameEvent[];
  readonly eventSeq: number;
  readonly cell?: Cell;
}): {
  readonly score: number;
  readonly best: number;
  readonly level: number;
  readonly events: readonly GameEvent[];
  readonly eventSeq: number;
} {
  const score = params.score + params.points;
  const best = Math.max(params.best, score);
  return {
    score,
    best,
    level: params.level,
    events: params.events,
    eventSeq: params.eventSeq,
  };
}

function shuffleWithRng<T>(items: readonly T[], rng: RngState): { items: T[]; rng: RngState } {
  const arr = [...items];
  let cur = rng;
  for (let i = arr.length - 1; i > 0; i--) {
    const draw = nextInt(cur, i + 1);
    cur = draw.next;
    const j = draw.value;
    const a = arr[i];
    const b = arr[j];
    if (a !== undefined && b !== undefined) {
      arr[i] = b;
      arr[j] = a;
    }
  }
  return { items: arr, rng: cur };
}

// ---------------------------------------------------------------------------
// Letter -> Picture -> Magic/Item bank (for letter_match quests)
// ---------------------------------------------------------------------------

interface LetterMagicEntry {
  readonly letter: string;
  readonly emoji: string;
  readonly wordVi?: string;
  readonly rewardEffect: QuestRewardEffect;
  readonly formColor?: SnakeForm;
  readonly rewardIconVi: string;
  readonly speechVi: string;
}

const LETTER_MAGIC_BANK: readonly LetterMagicEntry[] = [
  {
    letter: 'R',
    emoji: '🐉',
    rewardEffect: 'form_dragon',
    formColor: 'dragon',
    rewardIconVi: '🌸🔥 Phép Rồng',
    speechVi: 'Tìm chữ R, Rồng!',
  },
  {
    letter: 'B',
    emoji: '🦋',
    rewardEffect: 'fairy_butterfly',
    formColor: 'phoenix',
    rewardIconVi: '🦋✨ Hóa Bướm',
    speechVi: 'Tìm chữ B, Bướm Tiên!',
  },
  {
    letter: 'S',
    emoji: '⚡',
    rewardEffect: 'fairy_thunder_storm',
    formColor: 'unicorn',
    rewardIconVi: '⚡🌩️ Sấm Sét',
    speechVi: 'Tìm chữ S, Sấm Sét!',
  },
  {
    letter: 'H',
    emoji: '🌸',
    rewardEffect: 'fairy_flower_garden',
    formColor: 'spirit',
    rewardIconVi: '🌸🌷 Vườn Hoa',
    speechVi: 'Tìm chữ H, Thả Hoa!',
  },
  {
    letter: 'K',
    emoji: '🛡️',
    rewardEffect: 'item_shield',
    rewardIconVi: '🛡️🫧 Khiên',
    speechVi: 'Tìm chữ K, Khiên!',
  },
  {
    letter: 'L',
    emoji: '🔥',
    wordVi: 'Lửa',
    rewardEffect: 'aoe_fire_nova',
    rewardIconVi: '🔥💥 Phun Lửa',
    speechVi: 'Tìm chữ L, Phun Lửa!',
  },
  {
    letter: 'N',
    emoji: '🌊',
    wordVi: 'Nước',
    rewardEffect: 'aoe_water_tsunami',
    rewardIconVi: '🌊🌀 Phun Nước',
    speechVi: 'Tìm chữ N, Phun Nước!',
  },
  {
    letter: 'P',
    emoji: '🔮',
    wordVi: 'Phép',
    rewardEffect: 'aoe_arcane_nova',
    rewardIconVi: '🔮✨ Ma Thuật',
    speechVi: 'Tìm chữ P, Ma Thuật!',
  },
  {
    letter: 'T',
    emoji: '❤️',
    rewardEffect: 'item_heart',
    rewardIconVi: '❤️💖 +1 Tim',
    speechVi: 'Tìm chữ T, Trái Tim!',
  },
  {
    letter: 'G',
    emoji: '🌪️',
    rewardEffect: 'item_speed',
    rewardIconVi: '🌪️⚡ Siêu Tốc',
    speechVi: 'Tìm chữ G, Gió Thần!',
  },
  {
    letter: 'V',
    emoji: '👑',
    rewardEffect: 'item_giant',
    rewardIconVi: '👑✨ Kho Báu',
    speechVi: 'Tìm chữ V, Vương Miện!',
  },
  {
    letter: 'C',
    emoji: '🌈',
    rewardEffect: 'item_shield',
    rewardIconVi: '🌈🛡️ Cầu Vồng',
    speechVi: 'Tìm chữ C, Cầu Vồng!',
  },
  {
    letter: 'Đ',
    emoji: '❄️',
    rewardEffect: 'form_phoenix',
    formColor: 'phoenix',
    rewardIconVi: '🦅❄️ Phượng Băng',
    speechVi: 'Tìm chữ Đ, Đông Đá!',
  },
];

const DISTRACTOR_POOL: readonly { letter: string; emoji: string }[] = [
  { letter: 'M', emoji: '🐱' },
  { letter: 'O', emoji: '🐝' },
  { letter: 'D', emoji: '🍉' },
  { letter: 'G', emoji: '🎸' },
  { letter: 'A', emoji: '⭐' },
];

// ---------------------------------------------------------------------------
// Simple Word -> Picture -> Magic/Item bank (for word_spell quests)
// ---------------------------------------------------------------------------

interface SimpleWordEntry {
  readonly word: string;
  readonly slots: readonly string[];
  readonly emoji: string;
  readonly rewardEffect: QuestRewardEffect;
  readonly rewardIconVi: string;
  readonly speechVi?: string;
}

const SIMPLE_WORD_BANK: readonly SimpleWordEntry[] = [
  // 2-3 letter words
  {
    word: 'CÁ',
    slots: ['C', 'Á'],
    emoji: '🐟',
    rewardEffect: 'item_speed',
    rewardIconVi: '🐟⚡ Lướt Nhanh',
  },
  {
    word: 'HOA',
    slots: ['H', 'O', 'A'],
    emoji: '🌸',
    rewardEffect: 'fairy_flower_garden',
    rewardIconVi: '🌸🌷 Vườn Hoa',
  },
  {
    word: 'SÉT',
    slots: ['S', 'É', 'T'],
    emoji: '⚡',
    rewardEffect: 'fairy_thunder_storm',
    rewardIconVi: '⚡🌩️ Sấm Sét',
  },
  {
    word: 'LỬA',
    slots: ['L', 'Ử', 'A'],
    emoji: '🔥',
    rewardEffect: 'aoe_fire_nova',
    rewardIconVi: '🔥💥 Phun Lửa',
  },
  {
    word: 'SAO',
    slots: ['S', 'A', 'O'],
    emoji: '⭐',
    rewardEffect: 'item_giant',
    rewardIconVi: '⭐👑 Mưa Sao',
  },
  {
    word: 'TIM',
    slots: ['T', 'I', 'M'],
    emoji: '❤️',
    rewardEffect: 'item_heart',
    rewardIconVi: '❤️💖 +1 Tim',
  },
  {
    word: 'MÂY',
    slots: ['M', 'Â', 'Y'],
    emoji: '☁️',
    rewardEffect: 'item_shield',
    rewardIconVi: '☁️🛡️ Khiên Mây',
  },
  {
    word: 'HÚT',
    slots: ['H', 'Ú', 'T'],
    emoji: '🧲',
    rewardEffect: 'item_magnet',
    rewardIconVi: '🧲✨ Nam Châm',
  },
  // 4-letter words (used in age9)
  {
    word: 'BĂNG',
    slots: ['B', 'Ă', 'N', 'G'],
    emoji: '❄️',
    rewardEffect: 'form_phoenix',
    rewardIconVi: '❄️🦋 Đóng Băng',
  },
  {
    word: 'RỒNG',
    slots: ['R', 'Ồ', 'N', 'G'],
    emoji: '🐉',
    rewardEffect: 'form_dragon',
    rewardIconVi: '🐉🔥 Siêu Rồng',
  },
  {
    word: 'VÀNG',
    slots: ['V', 'À', 'N', 'G'],
    emoji: '👑',
    rewardEffect: 'item_giant',
    rewardIconVi: '👑✨ Kho Vàng',
  },
  {
    word: 'KIẾM',
    slots: ['K', 'I', 'Ế', 'M'],
    emoji: '⚔️',
    rewardEffect: 'item_speed',
    rewardIconVi: '⚔️⚡ Siêu Tốc',
  },
  {
    word: 'SÂU',
    slots: ['S', 'Â', 'U'],
    emoji: '🐛',
    rewardEffect: 'fairy_butterfly',
    rewardIconVi: '🐛🦋 Hóa Bướm',
  },
  {
    word: 'KÉN',
    slots: ['K', 'É', 'N'],
    emoji: '🥚',
    rewardEffect: 'fairy_butterfly',
    rewardIconVi: '🥚🦋 Kén Bướm',
  },
  {
    word: 'BƯỚM',
    slots: ['B', 'Ư', 'Ớ', 'M'],
    emoji: '🦋',
    rewardEffect: 'fairy_butterfly',
    rewardIconVi: '🦋✨ Bướm Tiên',
  },
  {
    word: 'NƯỚC',
    slots: ['N', 'Ư', 'Ớ', 'C'],
    emoji: '🌊',
    rewardEffect: 'aoe_water_tsunami',
    rewardIconVi: '🌊🌀 Phun Nước',
    speechVi: 'Đánh vần chữ Nước!',
  },
  {
    word: 'PHÉP',
    slots: ['P', 'H', 'É', 'P'],
    emoji: '🔮',
    rewardEffect: 'aoe_arcane_nova',
    rewardIconVi: '🔮✨ Ma Thuật',
    speechVi: 'Đánh vần chữ Phép!',
  },
];

// ---------------------------------------------------------------------------
// Math content builder (unchanged)
// ---------------------------------------------------------------------------

function buildMathContent(rng: RngState): {
  readonly promptVi: string;
  readonly hintVi: string;
  readonly choices: readonly { label: string; isCorrect: boolean }[];
  readonly rng: RngState;
} {
  let cur = rng;
  const opDraw = nextInt(cur, 4);
  cur = opDraw.next;

  let expr = '';
  let answer = 0;

  if (opDraw.value === 0) {
    const aDraw = nextInt(cur, 10);
    const bDraw = nextInt(aDraw.next, 10);
    cur = bDraw.next;
    const a = 3 + aDraw.value;
    const b = 3 + bDraw.value;
    answer = a * b;
    expr = `${a} × ${b} = ?`;
  } else if (opDraw.value === 1) {
    const bDraw = nextInt(cur, 8);
    const qDraw = nextInt(bDraw.next, 10);
    cur = qDraw.next;
    const b = 2 + bDraw.value;
    const q = 3 + qDraw.value;
    answer = q;
    expr = `${b * q} ÷ ${b} = ?`;
  } else if (opDraw.value === 2) {
    const aDraw = nextInt(cur, 45);
    const bDraw = nextInt(aDraw.next, 35);
    cur = bDraw.next;
    const a = 14 + aDraw.value;
    const b = 12 + bDraw.value;
    answer = a + b;
    expr = `${a} + ${b} = ?`;
  } else {
    const aDraw = nextInt(cur, 60);
    cur = aDraw.next;
    const a = 35 + aDraw.value;
    const bDraw = nextInt(cur, Math.max(1, a - 16));
    cur = bDraw.next;
    const b = 11 + bDraw.value;
    answer = a - b;
    expr = `${a} - ${b} = ?`;
  }

  const offsets = shuffleWithRng([-10, -3, -2, -1, 1, 2, 3, 10], cur);
  cur = offsets.rng;

  const distractors: number[] = [];
  for (const off of offsets.items) {
    const candidate = answer + off;
    if (candidate >= 1 && candidate !== answer && !distractors.includes(candidate)) {
      distractors.push(candidate);
      if (distractors.length === 2) break;
    }
  }
  while (distractors.length < 2) {
    const fallback = answer + distractors.length + 4;
    if (!distractors.includes(fallback)) distractors.push(fallback);
  }

  const rawChoices = [
    { label: String(answer), isCorrect: true },
    { label: String(distractors[0]!), isCorrect: false },
    { label: String(distractors[1]!), isCorrect: false },
  ];
  const shuffled = shuffleWithRng(rawChoices, cur);
  const rounded = Math.max(5, Math.round(answer / 5) * 5);

  return {
    promptVi: `🧮 Giải toán: ${expr}`,
    hintVi: `Gợi ý nhỏ: Đáp án nằm gần số ${rounded} đó bé!`,
    choices: shuffled.items,
    rng: shuffled.rng,
  };
}

// ---------------------------------------------------------------------------
// Quest orb position picker — supports variable count (2, 3, 4)
// ---------------------------------------------------------------------------

/** Pick `count` well-separated open-world orb positions ahead of the player's head. */
function pickQuestOrbPositions(
  state: GameState,
  head: Vec2,
  rng: RngState,
  count = 3,
  minDist = 9.0,
): { positions: readonly Vec2[]; rng: RngState } {
  let cur = rng;
  const safeBound = Math.max(4, state.config.worldRadius - 3);
  const maxDist = 16.0;
  const span = Math.max(0.5, maxDist - minDist);

  const baseAngleDraw = nextFloat(cur);
  cur = baseAngleDraw.next;
  const baseAngle = state.heading + (baseAngleDraw.value - 0.5) * 1.4;

  const offsets: readonly number[] =
    count === 2 ? [-0.65, 0.65] : count === 4 ? [-1.25, -0.42, 0.42, 1.25] : [-1.05, 0, 1.05];

  const positions: Vec2[] = [];
  for (const off of offsets) {
    const rDraw = nextFloat(cur);
    const jDraw = nextFloat(rDraw.next);
    cur = jDraw.next;
    const radius = minDist + rDraw.value * span;
    const angle = baseAngle + off + (jDraw.value - 0.5) * 0.3;
    let x = Number(clamp(head.x + Math.cos(angle) * radius, -safeBound, safeBound).toFixed(2));
    let z = Number(clamp(head.z + Math.sin(angle) * radius, -safeBound, safeBound).toFixed(2));

    // Enforce minimum spacing 2.4 between sibling orbs
    for (const prev of positions) {
      const d = Math.hypot(x - prev.x, z - prev.z);
      if (d < 2.4 && d > 1e-5) {
        const dx = x - prev.x;
        const dz = z - prev.z;
        const nx = dx / d;
        const nz = dz / d;
        x = Number(clamp(prev.x + nx * 2.4, -safeBound, safeBound).toFixed(2));
        z = Number(clamp(prev.z + nz * 2.4, -safeBound, safeBound).toFixed(2));
      }
    }

    positions.push({ x, z });
  }
  return { positions, rng: cur };
}

// ---------------------------------------------------------------------------
// Letter-match quest builder
// ---------------------------------------------------------------------------

function buildLetterMatchQuest(
  state: GameState,
  rng: RngState,
  questId: number,
  positions: readonly Vec2[],
): { quest: BrainQuest; rng: RngState } {
  let cur = rng;
  const tIdx = nextInt(cur, LETTER_MAGIC_BANK.length);
  cur = tIdx.next;
  const target = LETTER_MAGIC_BANK[tIdx.value]!;

  // Pick 2 distinct distractors
  const shuffledD = shuffleWithRng(
    DISTRACTOR_POOL.filter((d) => d.letter !== target.letter),
    cur,
  );
  cur = shuffledD.rng;
  const d1 = shuffledD.items[0]!;
  const d2 = shuffledD.items[1]!;

  const rawOrbs: { label: string; subLabel: string; isCorrect: boolean; spokenVi: string }[] = [
    { label: target.letter, subLabel: target.emoji, isCorrect: true, spokenVi: target.letter },
    { label: d1.letter, subLabel: d1.emoji, isCorrect: false, spokenVi: d1.letter },
    { label: d2.letter, subLabel: d2.emoji, isCorrect: false, spokenVi: d2.letter },
  ];
  const shuffled = shuffleWithRng(rawOrbs, cur);
  cur = shuffled.rng;

  const orbs: QuestOrb[] = shuffled.items.map((o, idx) => ({
    id: questId * 100 + idx + 1,
    cell: positions[idx]!,
    label: o.label,
    subLabel: o.subLabel,
    spokenVi: o.spokenVi,
    formColor: o.isCorrect ? target.formColor : undefined,
    isCorrect: o.isCorrect,
    collected: false,
  }));

  return {
    quest: {
      id: questId,
      kind: 'letter_match',
      promptVi: `${target.emoji} Chữ ${target.letter}`,
      hintVi: `Chạm chữ ${target.letter} ${target.emoji}!`,
      iconEmoji: target.emoji,
      targetWord: target.letter,
      wordSlots: [target.letter],
      rewardEffect: target.rewardEffect,
      rewardIconVi: target.rewardIconVi,
      speechVi: target.speechVi,
      orbs,
      nextSequenceIndex: 0,
      rewardScore: 100,
      rewardLevels: 10,
      ticksRemaining: state.ageProfile === 'age6' ? 560 : 440,
      maxTicks: state.ageProfile === 'age6' ? 560 : 440,
    },
    rng: cur,
  };
}

// ---------------------------------------------------------------------------
// Word-spell quest builder
// ---------------------------------------------------------------------------

function buildWordSpellQuest(
  state: GameState,
  rng: RngState,
  questId: number,
  minDist = 9.0,
): { quest: BrainQuest; rng: RngState } {
  let cur = rng;

  // Filter words by age
  const pool =
    state.ageProfile === 'age6'
      ? SIMPLE_WORD_BANK.filter((w) => w.slots.length <= 3)
      : SIMPLE_WORD_BANK.filter((w) => w.slots.length >= 3);

  const wIdx = nextInt(cur, pool.length);
  cur = wIdx.next;
  const entry = pool[wIdx.value]!;
  const slots = entry.slots;

  const head = state.snake[0];
  if (!head) {
    // Fallback: shouldn't happen but be safe
    return buildLetterMatchQuest(state, cur, questId, [
      { x: 5, z: 0 },
      { x: 7, z: 0 },
      { x: 9, z: 0 },
    ]);
  }

  const pickedPos = pickQuestOrbPositions(state, head, cur, slots.length, minDist);
  cur = pickedPos.rng;

  const orbs: QuestOrb[] = slots.map((letter, idx) => ({
    id: questId * 100 + idx + 1,
    cell: pickedPos.positions[idx]!,
    label: letter,
    spokenVi: letter,
    isCorrect: true,
    sequenceOrder: idx + 1,
    collected: false,
  }));

  return {
    quest: {
      id: questId,
      kind: 'word_spell',
      promptVi: `${entry.emoji} ${entry.word}`,
      hintVi: `Ăn theo thứ tự: ${slots.join(' ➔ ')}`,
      iconEmoji: entry.emoji,
      targetWord: entry.word,
      wordSlots: slots,
      rewardEffect: entry.rewardEffect,
      rewardIconVi: entry.rewardIconVi,
      speechVi: entry.speechVi ?? `Ghép chữ ${entry.word}!`,
      orbs,
      nextSequenceIndex: 1,
      rewardScore: 120,
      rewardLevels: 10,
      ticksRemaining: state.ageProfile === 'age6' ? 560 : 440,
      maxTicks: state.ageProfile === 'age6' ? 560 : 440,
    },
    rng: cur,
  };
}

// ---------------------------------------------------------------------------
// spawnQuest — age-aware quest distribution
// ---------------------------------------------------------------------------

/**
 * Spawn an immediate letter/word BrainQuest on tick 0 so kids see colorful
 * word/letter orbs right at launch while keeping close-ahead Spirit shots clear.
 */
export function spawnStarterQuest(
  state: GameState,
  rng: RngState,
): { quest: BrainQuest | null; rng: RngState } {
  const head = state.snake[0];
  if (!head) return { quest: null, rng };

  let cur = rng;
  const questId = state.eventSeq + 1;
  const roll = nextFloat(cur);
  cur = roll.next;

  // Place starter quest orbs at 13.3..16.0 so they stay visible without intercepting close Spirit shots
  const starterMinDist = 13.3;
  const kind: 'letter_match' | 'word_spell' =
    state.ageProfile === 'age6'
      ? roll.value < 0.7
        ? 'letter_match'
        : 'word_spell'
      : roll.value < 0.6
        ? 'word_spell'
        : 'letter_match';

  if (kind === 'letter_match') {
    const pickedPos = pickQuestOrbPositions(state, head, cur, 3, starterMinDist);
    cur = pickedPos.rng;
    return buildLetterMatchQuest(state, cur, questId, pickedPos.positions);
  }

  return buildWordSpellQuest(state, cur, questId, starterMinDist);
}

/** Create a deterministic BrainQuest with orbs ahead of the player's head. */
export function spawnQuest(
  state: GameState,
  rng: RngState,
  kindOverride?: QuestKind,
): { quest: BrainQuest | null; rng: RngState } {
  const head = state.snake[0];
  if (!head) return { quest: null, rng };

  let cur = rng;
  const questId = state.eventSeq + 1;

  // Determine kind
  let kind: QuestKind;
  if (kindOverride) {
    kind = kindOverride;
  } else {
    const roll = nextFloat(cur);
    cur = roll.next;
    const v = roll.value;

    if (state.ageProfile === 'age6') {
      // 75% letter_match, 25% word_spell (never math)
      kind = v < 0.75 ? 'letter_match' : 'word_spell';
    } else {
      // age9: 55% word_spell, 20% letter_match, 15% math, 10% element_match
      if (v < 0.55) kind = 'word_spell';
      else if (v < 0.75) kind = 'letter_match';
      else if (v < 0.9) kind = 'math';
      else kind = 'element_match';
    }
  }

  // letter_match
  if (kind === 'letter_match') {
    const pickedPos = pickQuestOrbPositions(state, head, cur, 3);
    cur = pickedPos.rng;
    return buildLetterMatchQuest(state, cur, questId, pickedPos.positions);
  }

  // word_spell
  if (kind === 'word_spell') {
    return buildWordSpellQuest(state, cur, questId);
  }

  // For math, element_match, sequence: use original 3-orb layout, no rewardEffect
  const pickedPos = pickQuestOrbPositions(state, head, cur);
  cur = pickedPos.rng;
  const chosenCells = pickedPos.positions;

  const maxTicks =
    state.ageProfile === 'age6'
      ? 560
      : state.mode === 'cozy'
        ? 480
        : state.mode === 'reflex'
          ? 320
          : 440;
  const rewardScore = 100 + state.level * 15;
  const rewardLevels = 10;

  if (kind === 'math') {
    const math = buildMathContent(cur);
    cur = math.rng;
    const orbs: QuestOrb[] = math.choices.map((c, idx) => ({
      id: questId * 100 + idx + 1,
      cell: chosenCells[idx]!,
      label: c.label,
      isCorrect: c.isCorrect,
      collected: false,
    }));
    return {
      quest: {
        id: questId,
        kind: 'math',
        promptVi: math.promptVi,
        hintVi: math.hintVi,
        orbs,
        nextSequenceIndex: 0,
        rewardScore,
        rewardLevels,
        ticksRemaining: maxTicks,
        maxTicks,
      },
      rng: cur,
    };
  }

  if (kind === 'sequence') {
    const orbs: QuestOrb[] = [1, 2, 3].map((order, idx) => ({
      id: questId * 100 + idx + 1,
      cell: chosenCells[idx]!,
      label: String(order),
      isCorrect: true,
      sequenceOrder: order,
      collected: false,
    }));
    return {
      quest: {
        id: questId,
        kind: 'sequence',
        promptVi: '⭐ Thứ tự Ánh Sao: Chạm 1 → 2 → 3',
        hintVi: 'Hãy tìm ngôi sao số 1 trước rồi đến 2 và 3 nhé!',
        orbs,
        nextSequenceIndex: 1,
        rewardScore,
        rewardLevels,
        ticksRemaining: maxTicks,
        maxTicks,
      },
      rng: cur,
    };
  }

  // element_match
  const otherForms = SNAKE_FORMS.filter((f) => f !== state.form);
  const targetPool = otherForms.length > 0 ? otherForms : SNAKE_FORMS;
  const tDraw = nextInt(cur, targetPool.length);
  cur = tDraw.next;
  const targetForm = targetPool[tDraw.value] ?? 'phoenix';

  const distractForms = SNAKE_FORMS.filter((f) => f !== targetForm);
  const shuffledDistractors = shuffleWithRng(distractForms, cur);
  cur = shuffledDistractors.rng;
  const formChoices = shuffleWithRng(
    [
      { form: targetForm, isCorrect: true },
      { form: shuffledDistractors.items[0] ?? 'dragon', isCorrect: false },
      { form: shuffledDistractors.items[1] ?? 'spirit', isCorrect: false },
    ],
    cur,
  );
  cur = formChoices.rng;

  const meta = FORM_METADATA[targetForm];
  const orbs: QuestOrb[] = formChoices.items.map((choice, idx) => ({
    id: questId * 100 + idx + 1,
    cell: chosenCells[idx]!,
    label: FORM_METADATA[choice.form].emoji,
    formColor: choice.form,
    isCorrect: choice.isCorrect,
    collected: false,
  }));

  return {
    quest: {
      id: questId,
      kind: 'element_match',
      promptVi: `🔮 Biến hình ${meta.nameVi} & chạm ngọc ${meta.emoji}`,
      hintVi: `Nhấn L1/R1 (hoặc 1-4) để đổi sang ${meta.nameVi} nhé!`,
      orbs,
      nextSequenceIndex: 0,
      targetForm,
      rewardScore,
      rewardLevels,
      ticksRemaining: maxTicks,
      maxTicks,
    },
    rng: cur,
  };
}

/** Probabilistically spawn a new BrainQuest when none is currently active. */
export function maybeSpawnQuest(state: GameState, rng: RngState): GameState {
  if (state.quest !== null) {
    return { ...state, rng };
  }

  const chance = state.ageProfile === 'age6' ? 0.045 : 0.032;
  const roll = nextFloat(rng);
  if (roll.value >= chance) {
    return { ...state, rng: roll.next };
  }

  const spawned = spawnQuest(state, roll.next);
  if (!spawned.quest) {
    return { ...state, rng: spawned.rng };
  }

  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'quest_spawn',
      messageVi: spawned.quest.promptVi,
    },
  ]);

  return {
    ...state,
    quest: spawned.quest,
    rng: spawned.rng,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

/** Advance the active quest timer by one tick, expiring quietly at 0. */
export function tickQuest(quest: BrainQuest | null): BrainQuest | null {
  if (!quest) return null;
  const remaining = quest.ticksRemaining - 1;
  if (remaining <= 0) return null;
  return { ...quest, ticksRemaining: remaining };
}

// ---------------------------------------------------------------------------
// completeQuest — with linked magic/item reward effects
// ---------------------------------------------------------------------------

function completeQuest(state: GameState, quest: BrainQuest, hitCell: Cell): GameState {
  const questsSolved = state.questsSolved + 1;
  const combo = state.combo + 1;
  const nextLevel = state.level + quest.rewardLevels;
  const nextBossProgress = Math.min(100, state.bossProgress + 20);
  const score = state.score + quest.rewardScore;
  const best = Math.max(state.best, score);

  const boosterGrant = grantBoosterCharge(state.boosters, questsSolved);
  let boosters = boosterGrant.boosters;

  const drafts: EventDraft[] = [
    {
      kind: 'quest_complete',
      cell: hitCell,
      points: quest.rewardScore,
      messageVi: `${quest.rewardIconVi ?? '🌟 Giỏi quá!'} +${quest.rewardLevels} Cấp!`,
    },
    {
      kind: 'level_up',
      cell: hitCell,
      messageVi: `Chúc mừng! Bé lên Cấp ${nextLevel}! 🎉`,
    },
  ];

  let hearts = state.hearts;
  if (questsSolved % 3 === 0 && hearts < state.maxHearts) {
    hearts += 1;
    drafts.push({
      kind: 'heart_gained',
      cell: hitCell,
      messageVi: 'Thưởng +1 Tim phép thuật! 💖',
    });
  }

  // Apply linked reward effect
  let form = state.form;
  let absorbedPower = state.absorbedPower;
  let shieldTicks = state.shieldTicks;
  let shieldCooldownTicks = state.shieldCooldownTicks;
  let orbs = state.orbs;
  let rng = state.rng;

  const effect = quest.rewardEffect;
  if (effect) {
    switch (effect) {
      case 'form_dragon':
        form = 'dragon';
        absorbedPower = {
          form: 'dragon',
          titleVi: '🌸🔥 Phép Rồng',
          ticksRemaining: 180,
          maxTicks: 180,
        };
        break;
      case 'form_phoenix': {
        form = 'phoenix';
        absorbedPower = {
          form: 'phoenix',
          titleVi: '❄️🦋 Phép Băng',
          ticksRemaining: 180,
          maxTicks: 180,
        };
        // Freeze bots within 20 units
        const frozenBots = state.bots.map((b) => {
          const d = Math.hypot(b.head.x - hitCell.x, b.head.z - hitCell.z);
          return d <= 20 ? { ...b, frozenTicks: Math.max(b.frozenTicks, 45) } : b;
        });
        // We'll apply frozenBots below via working state
        return applyCompleteQuestFinalize(state, {
          questsSolved,
          combo,
          nextLevel,
          nextBossProgress,
          score,
          best,
          boosters,
          hearts,
          form,
          absorbedPower,
          shieldTicks,
          shieldCooldownTicks,
          orbs,
          rng,
          drafts,
          hitCell,
          bots: frozenBots,
        });
      }
      case 'form_unicorn':
        form = 'unicorn';
        absorbedPower = {
          form: 'unicorn',
          titleVi: '⚡✨ Phép Sét',
          ticksRemaining: 180,
          maxTicks: 180,
        };
        boosters = {
          ...boosters,
          magnet: { ...boosters.magnet, activeTicks: Math.max(boosters.magnet.activeTicks, 140) },
        };
        break;
      case 'form_spirit': {
        form = 'spirit';
        absorbedPower = {
          form: 'spirit',
          titleVi: '🌸🍀 Phép Hoa',
          ticksRemaining: 180,
          maxTicks: 180,
        };
        if (hearts < state.maxHearts) {
          hearts += 1;
          drafts.push({ kind: 'heart_gained', cell: hitCell, messageVi: '🌸 +1 Tim!' });
        }
        // Scatter 6 celebration loot orbs
        const scattered = scatterLootOrbs({
          orbs: [...state.orbs],
          spine: [hitCell, hitCell, hitCell, hitCell, hitCell, hitCell],
          count: 6,
          value: 2,
          config: state.config,
          rng,
        });
        orbs = scattered.orbs;
        rng = scattered.rng;
        break;
      }
      case 'item_shield':
        shieldTicks = Math.max(shieldTicks, 120);
        shieldCooldownTicks = 0;
        break;
      case 'item_magnet':
        boosters = {
          ...boosters,
          magnet: { ...boosters.magnet, activeTicks: Math.max(boosters.magnet.activeTicks, 200) },
        };
        break;
      case 'item_speed':
        boosters = {
          ...boosters,
          speed: { ...boosters.speed, activeTicks: Math.max(boosters.speed.activeTicks, 160) },
        };
        break;
      case 'item_heart':
        if (hearts < state.maxHearts) {
          hearts += 1;
          drafts.push({ kind: 'heart_gained', cell: hitCell, messageVi: '❤️ +1 Tim!' });
        }
        shieldTicks = Math.max(shieldTicks, 80);
        break;
      case 'item_giant': {
        // +1 extra charge to level booster (max 3)
        const lvSlot = boosters.level;
        if (lvSlot.charges < 3) {
          boosters = {
            ...boosters,
            level: { ...lvSlot, charges: Math.min(3, lvSlot.charges + 1) },
          };
        }
        // Scatter 8 high-value golden loot orbs deterministically around hitCell
        const gScattered = scatterLootOrbs({
          orbs: [...state.orbs],
          spine: [hitCell],
          count: 8,
          value: 3,
          config: state.config,
          rng,
        });
        orbs = gScattered.orbs;
        rng = gScattered.rng;
        boosters = {
          ...boosters,
          magnet: { ...boosters.magnet, activeTicks: Math.max(boosters.magnet.activeTicks, 90) },
        };
        break;
      }
      case 'fairy_butterfly': {
        // Apply base finalize first, then trigger metamorphosis
        const baseState = applyCompleteQuestFinalize(state, {
          questsSolved,
          combo,
          nextLevel,
          nextBossProgress,
          score,
          best,
          boosters,
          hearts,
          form,
          absorbedPower,
          shieldTicks,
          shieldCooldownTicks,
          orbs,
          rng,
          drafts,
          hitCell,
        });
        return triggerButterflyMetamorphosisInstant(baseState);
      }
      case 'fairy_flower_garden': {
        const baseState = applyCompleteQuestFinalize(state, {
          questsSolved,
          combo,
          nextLevel,
          nextBossProgress,
          score,
          best,
          boosters,
          hearts,
          form,
          absorbedPower,
          shieldTicks,
          shieldCooldownTicks,
          orbs,
          rng,
          drafts,
          hitCell,
        });
        return spawnFlowerRing(baseState, 6);
      }
      case 'fairy_thunder_storm': {
        const baseState = applyCompleteQuestFinalize(state, {
          questsSolved,
          combo,
          nextLevel,
          nextBossProgress,
          score,
          best,
          boosters,
          hearts,
          form,
          absorbedPower,
          shieldTicks,
          shieldCooldownTicks,
          orbs,
          rng,
          drafts,
          hitCell,
        });
        return spawnThunderStorm(baseState);
      }
      case 'aoe_fire_nova': {
        const baseState = applyCompleteQuestFinalize(state, {
          questsSolved,
          combo,
          nextLevel,
          nextBossProgress,
          score,
          best,
          boosters,
          hearts,
          form,
          absorbedPower,
          shieldTicks,
          shieldCooldownTicks,
          orbs,
          rng,
          drafts,
          hitCell,
        });
        return spawnFireNova(baseState);
      }
      case 'aoe_water_tsunami': {
        const baseState = applyCompleteQuestFinalize(state, {
          questsSolved,
          combo,
          nextLevel,
          nextBossProgress,
          score,
          best,
          boosters,
          hearts,
          form,
          absorbedPower,
          shieldTicks,
          shieldCooldownTicks,
          orbs,
          rng,
          drafts,
          hitCell,
        });
        return spawnWaterTsunami(baseState);
      }
      case 'aoe_arcane_nova': {
        const baseState = applyCompleteQuestFinalize(state, {
          questsSolved,
          combo,
          nextLevel,
          nextBossProgress,
          score,
          best,
          boosters,
          hearts,
          form,
          absorbedPower,
          shieldTicks,
          shieldCooldownTicks,
          orbs,
          rng,
          drafts,
          hitCell,
        });
        return spawnArcaneNova(baseState);
      }
    }
  }

  return applyCompleteQuestFinalize(state, {
    questsSolved,
    combo,
    nextLevel,
    nextBossProgress,
    score,
    best,
    boosters,
    hearts,
    form,
    absorbedPower,
    shieldTicks,
    shieldCooldownTicks,
    orbs,
    rng,
    drafts,
    hitCell,
  });
}

function applyCompleteQuestFinalize(
  state: GameState,
  p: {
    questsSolved: number;
    combo: number;
    nextLevel: number;
    nextBossProgress: number;
    score: number;
    best: number;
    boosters: BoostersState;
    hearts: number;
    form: SnakeForm;
    absorbedPower: GameState['absorbedPower'];
    shieldTicks: number;
    shieldCooldownTicks: number;
    orbs: GameState['orbs'];
    rng: RngState;
    drafts: EventDraft[];
    hitCell: Cell;
    bots?: GameState['bots'];
  },
): GameState {
  const ev = appendEvents(state.events, state.eventSeq, p.drafts);
  return {
    ...state,
    quest: null,
    questsSolved: p.questsSolved,
    combo: p.combo,
    hearts: p.hearts,
    level: p.nextLevel,
    score: p.score,
    best: p.best,
    bossProgress: p.nextBossProgress,
    boosters: p.boosters,
    form: p.form,
    absorbedPower: p.absorbedPower,
    shieldTicks: p.shieldTicks,
    shieldCooldownTicks: p.shieldCooldownTicks,
    orbs: p.orbs,
    rng: p.rng,
    bots: p.bots ?? state.bots,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

// ---------------------------------------------------------------------------
// applyQuestOrbHit — handles letter_match, word_spell, and existing kinds
// ---------------------------------------------------------------------------

/**
 * Resolve touching or shooting an uncollected {@link QuestOrb}.
 * Wrong choices NEVER cost hearts — they gently encourage the player.
 */
export function applyQuestOrbHit(state: GameState, orbId: number): GameState {
  const quest = state.quest;
  if (!quest) return state;

  const orb = quest.orbs.find((o) => o.id === orbId && !o.collected);
  if (!orb) return state;

  // letter_match: correct = complete immediately, wrong = gentle hint
  if (quest.kind === 'letter_match') {
    if (orb.isCorrect) {
      return completeQuest(state, quest, orb.cell);
    }
    const updatedOrbs = quest.orbs.map((o) => (o.id === orb.id ? { ...o, collected: true } : o));
    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'quest_wrong',
        cell: orb.cell,
        messageVi: `💡 Chữ ${quest.targetWord ?? ''} ${quest.iconEmoji ?? ''} kìa!`,
      },
    ]);
    return {
      ...state,
      quest: { ...quest, orbs: updatedOrbs },
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  if (quest.kind === 'math') {
    if (orb.isCorrect) {
      return completeQuest(state, quest, orb.cell);
    }
    const updatedOrbs = quest.orbs.map((o) => (o.id === orb.id ? { ...o, collected: true } : o));
    const ev = appendEvents(state.events, state.eventSeq, [
      { kind: 'quest_wrong', cell: orb.cell, messageVi: quest.hintVi },
    ]);
    return {
      ...state,
      quest: { ...quest, orbs: updatedOrbs },
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  if (quest.kind === 'element_match') {
    if (orb.isCorrect && quest.targetForm !== undefined) {
      if (state.form === quest.targetForm) {
        return completeQuest(state, quest, orb.cell);
      }
      const meta = FORM_METADATA[quest.targetForm];
      const ev = appendEvents(state.events, state.eventSeq, [
        {
          kind: 'quest_wrong',
          cell: orb.cell,
          form: quest.targetForm,
          messageVi: `Gần được rồi! Hãy biến hình sang ${meta.nameVi} trước nhé!`,
        },
      ]);
      return {
        ...state,
        events: ev.events,
        eventSeq: ev.eventSeq,
      };
    }

    const updatedOrbs = quest.orbs.map((o) => (o.id === orb.id ? { ...o, collected: true } : o));
    const ev = appendEvents(state.events, state.eventSeq, [
      { kind: 'quest_wrong', cell: orb.cell, messageVi: quest.hintVi },
    ]);
    return {
      ...state,
      quest: { ...quest, orbs: updatedOrbs },
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  // word_spell and sequence: collect in order 1 -> 2 -> 3 ...
  if (orb.sequenceOrder === quest.nextSequenceIndex) {
    const updatedOrbs = quest.orbs.map((o) => (o.id === orb.id ? { ...o, collected: true } : o));
    const allDone = updatedOrbs.every((o) => o.collected);
    if (allDone) {
      return completeQuest(state, quest, orb.cell);
    }

    const nextIndex = quest.nextSequenceIndex + 1;
    const progressPoints = 25;
    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'quest_progress',
        cell: orb.cell,
        points: progressPoints,
        messageVi: orb.label,
      },
    ]);
    const scored = applyScoreGain({
      score: state.score,
      best: state.best,
      level: state.level,
      points: progressPoints,
      events: ev.events,
      eventSeq: ev.eventSeq,
      cell: orb.cell,
    });
    return {
      ...state,
      quest: { ...quest, orbs: updatedOrbs, nextSequenceIndex: nextIndex },
      score: scored.score,
      best: scored.best,
      events: scored.events,
      eventSeq: scored.eventSeq,
    };
  }

  // Out-of-order for word_spell: gentle hint, don't consume orb
  if (quest.kind === 'word_spell') {
    const expectedOrb = quest.orbs.find(
      (o) => o.sequenceOrder === quest.nextSequenceIndex && !o.collected,
    );
    const expectedLabel = expectedOrb?.label ?? '';
    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'quest_wrong',
        cell: orb.cell,
        messageVi: `💡 Chữ ${expectedLabel} trước nhé!`,
      },
    ]);
    return {
      ...state,
      events: ev.events,
      eventSeq: ev.eventSeq,
    };
  }

  // sequence out-of-order
  const ev = appendEvents(state.events, state.eventSeq, [
    {
      kind: 'quest_wrong',
      cell: orb.cell,
      messageVi: `Tìm số ${quest.nextSequenceIndex} trước nhé bé!`,
    },
  ]);
  return {
    ...state,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}
