export interface AchievementDef {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  readonly icon?: string;
}

export const ACHIEVEMENTS: readonly AchievementDef[] = [
  {
    id: 'first-bite',
    name: 'Khởi Đầu Phép Thuật',
    description: 'Thu thập viên pha lê đầu tiên trong vương quốc!',
    icon: '✨',
  },
  {
    id: 'halfway-there',
    name: 'Ngôi Sao Tỏa Sáng',
    description: 'Đạt mốc 100 điểm lung linh trong một hành trình!',
    icon: '🌟',
  },
  {
    id: 'speed-demon',
    name: 'Huyền Thoại Rắn Tiên',
    description: 'Chinh phục mốc 300 điểm rực rỡ!',
    icon: '👑',
  },
  {
    id: 'meteor-shooter',
    name: 'Xạ Thủ Sao Băng',
    description: 'Hạ gục 5 quái vật bằng đạn phép thuật!',
    icon: '🏹',
  },
  {
    id: 'shape-shifter',
    name: 'Bậc Thầy Biến Hình',
    description: 'Biến hình qua đủ cả 4 linh thú phép thuật!',
    icon: '🦋',
  },
  {
    id: 'bright-mind',
    name: 'Trí Tuệ Tỏa Sáng',
    description: 'Giải đúng 5 câu đố thông minh trong một ván!',
    icon: '🧠',
  },
  {
    id: 'shield-guardian',
    name: 'Chiến Binh Bong Bóng',
    description: 'Dùng Khiên Bong Bóng chặn nguy hiểm 2 lần!',
    icon: '🫧',
  },
  {
    id: 'iron-wall',
    name: 'Trái Tim Bền Bỉ',
    description: 'Vượt qua 3 lần thu hẹp sân chơi an toàn!',
    icon: '🛡️',
  },
  {
    id: 'perfectionist',
    name: 'Nữ Hoàng Vương Quốc',
    description: 'Chiến thắng rực rỡ bằng cách lấp đầy toàn bộ sân chơi!',
    icon: '💎',
  },
  {
    id: 'comeback-kid',
    name: 'Vượt Chính Mình',
    description: 'Phá kỷ lục cũ của bản thân thêm từ 50 điểm trở lên!',
    icon: '🚀',
  },
  {
    id: 'night-crawler',
    name: 'Cú Đêm Ngắm Sao',
    description: 'Phiêu lưu giữa đêm khuya lung linh ánh sao.',
    icon: '🌙',
  },
  {
    id: 'three-day-streak',
    name: 'Khởi Động Đều Đặn',
    description: 'Chơi vui vẻ 3 ngày liên tiếp!',
    icon: '🌱',
  },
  {
    id: 'week-streak',
    name: 'Bạn Thân Vương Quốc',
    description: 'Đồng hành cùng Rắn Tiên suốt 7 ngày liền!',
    icon: '🌸',
  },
  {
    id: 'neon-regular',
    name: 'Ngôi Sao Kiên Trì',
    description: 'Chuỗi 30 ngày phiêu lưu kỳ diệu!',
    icon: '🌈',
  },
  {
    id: 'top-three',
    name: 'Bảng Vàng Vinh Danh',
    description: 'Ghi danh vào Top 3 kỷ lục cá nhân!',
    icon: '🏆',
  },
  {
    id: 'bot-hunter',
    name: 'Thợ Săn Nhí',
    description: 'Nuốt chửng rắn Bot đầu tiên trong đấu trường!',
    icon: '🐍',
  },
  {
    id: 'honeycomb-champion',
    name: 'Bá Chủ Tổ Ong',
    description: 'Hạ gục và ăn gọn 5 rắn Bot trong một trận đấu!',
    icon: '🍯',
  },
  {
    id: 'dragon-slayer',
    name: 'Dũng Sĩ Diệt Rồng',
    description: 'Đánh bại Boss Đại Vương Rồng uy lực!',
    icon: '🐉',
  },
  {
    id: 'crown-queen',
    name: 'Nữ Hoàng Vương Miện',
    description: 'Vươn lên chiếm ngôi Hạng #1 trên Bảng Xếp Hạng!',
    icon: '👑',
  },
];

export interface RunEvent {
  readonly nextScore: number;
  readonly won: boolean;
  readonly isGameOver: boolean;
  readonly bestAtRunStart: number;
  readonly pendingShrinkSurvivals: number;
  readonly hour: number;
  readonly enemiesDefeated?: number;
  readonly formsUsedCount?: number;
  readonly questsSolved?: number;
  readonly shieldBlocks?: number;
  readonly botsEaten?: number;
  readonly bossesDefeated?: number;
  readonly playerRank?: number;
}

/** Pure: given one run's state and the already-unlocked set, return newly-unlocked ids. */
export function evaluateRunAchievements(event: RunEvent, unlocked: ReadonlySet<string>): string[] {
  const newly: string[] = [];
  const maybeUnlock = (id: string, condition: boolean): void => {
    if (condition && !unlocked.has(id)) newly.push(id);
  };

  maybeUnlock('first-bite', event.nextScore >= 1);
  maybeUnlock('halfway-there', event.nextScore >= 100);
  maybeUnlock('speed-demon', event.nextScore >= 300);
  maybeUnlock('meteor-shooter', (event.enemiesDefeated ?? 0) >= 5);
  maybeUnlock('shape-shifter', (event.formsUsedCount ?? 0) >= 4);
  maybeUnlock('bright-mind', (event.questsSolved ?? 0) >= 5);
  maybeUnlock('shield-guardian', (event.shieldBlocks ?? 0) >= 2);
  maybeUnlock('iron-wall', event.pendingShrinkSurvivals >= 3);
  maybeUnlock('night-crawler', event.hour >= 0 && event.hour < 4);
  maybeUnlock('bot-hunter', (event.botsEaten ?? 0) >= 1);
  maybeUnlock('honeycomb-champion', (event.botsEaten ?? 0) >= 5);
  maybeUnlock('dragon-slayer', (event.bossesDefeated ?? 0) >= 1);
  maybeUnlock('crown-queen', event.playerRank === 1);

  if (event.isGameOver) {
    maybeUnlock('perfectionist', event.won);
    maybeUnlock(
      'comeback-kid',
      event.bestAtRunStart > 0 && event.nextScore - event.bestAtRunStart >= 50,
    );
  }

  return newly;
}

/** Pure: given the current daily streak length, return newly-crossed streak ids. */
export function evaluateStreakAchievements(
  streakCount: number,
  unlocked: ReadonlySet<string>,
): string[] {
  const newly: string[] = [];
  const maybeUnlock = (id: string, threshold: number): void => {
    if (streakCount >= threshold && !unlocked.has(id)) newly.push(id);
  };
  maybeUnlock('three-day-streak', 3);
  maybeUnlock('week-streak', 7);
  maybeUnlock('neon-regular', 30);
  return newly;
}

/** Pure: given a local leaderboard rank (1-based, null if unranked), return newly-unlocked ids. */
export function evaluateLeaderboardAchievements(
  rank: number | null,
  unlocked: ReadonlySet<string>,
): string[] {
  if (rank !== null && rank <= 3 && !unlocked.has('top-three')) return ['top-three'];
  return [];
}

const UNLOCKED_KEY = 'neonSnakeAchievements';

function safeGet(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSet(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* storage unavailable — best-effort only */
  }
}

export function loadUnlockedAchievements(): Set<string> {
  const raw = safeGet(UNLOCKED_KEY);
  if (!raw) return new Set();
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed)
      ? new Set(parsed.filter((id): id is string => typeof id === 'string'))
      : new Set();
  } catch {
    return new Set();
  }
}

export function unlockAchievements(ids: readonly string[]): void {
  if (ids.length === 0) return;
  const merged = loadUnlockedAchievements();
  for (const id of ids) merged.add(id);
  safeSet(UNLOCKED_KEY, JSON.stringify([...merged]));
}
