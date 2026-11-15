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
  type RngState,
  type SnakeForm,
  type Vec2,
} from './types';
import { FORM_METADATA } from './config';
import { nextFloat, nextInt } from './rng';
import { clamp } from './systems/arena';

export interface EventDraft {
  readonly kind: GameEventKind;
  readonly cell?: Cell;
  readonly form?: SnakeForm;
  readonly points?: number;
  readonly messageVi?: string;
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

/** Pick 3 well-separated open-world orb positions in radius `9..16` around the player's head. */
function pickQuestOrbPositions(
  state: GameState,
  head: Vec2,
  rng: RngState,
): { positions: readonly Vec2[]; rng: RngState } {
  let cur = rng;
  const bound = Math.max(4, state.config.worldRadius - 3);
  const minR = Math.min(9, Math.max(2, state.config.worldRadius * 0.35));
  const maxR = Math.min(16, Math.max(minR + 1, state.config.worldRadius - 3));

  const baseAngleDraw = nextFloat(cur);
  cur = baseAngleDraw.next;
  const baseAngle = state.heading + (baseAngleDraw.value - 0.5) * 1.4;
  const offsets = [-1.05, 0, 1.05];

  const positions: Vec2[] = [];
  for (const off of offsets) {
    const rDraw = nextFloat(cur);
    const jDraw = nextFloat(rDraw.next);
    cur = jDraw.next;
    const radius = minR + rDraw.value * (maxR - minR);
    const angle = baseAngle + off + (jDraw.value - 0.5) * 0.3;
    const x = Number(clamp(head.x + Math.cos(angle) * radius, -bound, bound).toFixed(2));
    const z = Number(clamp(head.z + Math.sin(angle) * radius, -bound, bound).toFixed(2));
    positions.push({ x, z });
  }
  return { positions, rng: cur };
}

/** Create a deterministic BrainQuest with 3 orbs at `9..16` units from the player's head. */
export function spawnQuest(
  state: GameState,
  rng: RngState,
  kindOverride?: QuestKind,
): { quest: BrainQuest | null; rng: RngState } {
  const head = state.snake[0];
  if (!head) return { quest: null, rng };

  const pickedPos = pickQuestOrbPositions(state, head, rng);
  let cur = pickedPos.rng;
  const chosenCells = pickedPos.positions;

  const kinds: readonly QuestKind[] = ['math', 'element_match', 'sequence'];
  let kind: QuestKind;
  if (kindOverride) {
    kind = kindOverride;
  } else {
    const kDraw = nextInt(cur, kinds.length);
    cur = kDraw.next;
    kind = kinds[kDraw.value] ?? 'math';
  }

  const questId = state.eventSeq + 1;
  const rewardScore = 100 + state.level * 15;
  const rewardLevels = 10;
  const maxTicks = state.mode === 'cozy' ? 480 : state.mode === 'reflex' ? 320 : 400;

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

  const chance = state.mode === 'cozy' ? 0.03 : state.mode === 'reflex' ? 0.02 : 0.025;
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

function completeQuest(state: GameState, quest: BrainQuest, hitCell: Cell): GameState {
  const questsSolved = state.questsSolved + 1;
  const combo = state.combo + 1;
  const nextLevel = state.level + quest.rewardLevels;
  const nextBossProgress = Math.min(100, state.bossProgress + 20);
  const score = state.score + quest.rewardScore;
  const best = Math.max(state.best, score);

  const boosterGrant = grantBoosterCharge(state.boosters, questsSolved);

  const drafts: EventDraft[] = [
    {
      kind: 'quest_complete',
      cell: hitCell,
      points: quest.rewardScore,
      messageVi: `Tuyệt vời! Bé giải đúng +${quest.rewardLevels} Cấp! 🌟`,
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

  const ev = appendEvents(state.events, state.eventSeq, drafts);

  return {
    ...state,
    quest: null,
    questsSolved,
    combo,
    hearts,
    level: nextLevel,
    score,
    best,
    bossProgress: nextBossProgress,
    boosters: boosterGrant.boosters,
    events: ev.events,
    eventSeq: ev.eventSeq,
  };
}

/**
 * Resolve touching or shooting an uncollected {@link QuestOrb}.
 * Wrong choices NEVER cost hearts — they gently encourage the player.
 */
export function applyQuestOrbHit(state: GameState, orbId: number): GameState {
  const quest = state.quest;
  if (!quest) return state;

  const orb = quest.orbs.find((o) => o.id === orbId && !o.collected);
  if (!orb) return state;

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

  // sequence: collect 1 -> 2 -> 3 in order
  if (orb.sequenceOrder === quest.nextSequenceIndex) {
    const updatedOrbs = quest.orbs.map((o) => (o.id === orb.id ? { ...o, collected: true } : o));
    const allDone = updatedOrbs.every((o) => o.collected);
    if (allDone) {
      return completeQuest(state, quest, orb.cell);
    }

    const nextIndex = quest.nextSequenceIndex + 1;
    const progressPoints = 20;
    const ev = appendEvents(state.events, state.eventSeq, [
      {
        kind: 'quest_progress',
        cell: orb.cell,
        points: progressPoints,
        messageVi: `Đúng rồi! Tiếp theo tìm số ${nextIndex} ⭐`,
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
