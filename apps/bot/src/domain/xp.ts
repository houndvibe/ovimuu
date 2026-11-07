// XP and level rules. Pure functions, no grammY / DB dependencies.

export const XP_PER_INTAKE = 10;
export const DAY_BONUS_XP = 20;
/** Intake XP only if confirmed within this time from scheduled_at. */
export const XP_WINDOW_MS = 24 * 60 * 60 * 1000;

/** Total XP needed to reach `level` (level N → N+1 costs 100 × N). */
export function xpForLevel(level: number): number {
  return 50 * level * (level - 1);
}

export function levelForXp(xp: number): number {
  let level = 1;
  while (xp >= xpForLevel(level + 1)) level++;
  return level;
}

/** Progress inside the current level: e.g. 130 XP → level 2, 30 of 200. */
export function levelProgress(xp: number): { level: number; current: number; needed: number } {
  const level = levelForXp(xp);
  return { level, current: xp - xpForLevel(level), needed: 100 * level };
}

/**
 * A scheduled intake earns XP if it was confirmed no later than 24 h after its time.
 * Ad-hoc intakes (no schedule) never earn XP.
 */
export function isXpEligible(i: {
  scheduleId: number | null;
  scheduledAt: Date;
  confirmedAt: Date | null;
}): boolean {
  if (i.scheduleId === null || i.confirmedAt === null) return false;
  return i.confirmedAt.getTime() - i.scheduledAt.getTime() <= XP_WINDOW_MS;
}

/** Day bonus: every scheduled intake of the day earned intake XP (and there was ≥ 1). */
export function isDayComplete(dayIntakes: { hasXp: boolean }[]): boolean {
  return dayIntakes.length > 0 && dayIntakes.every((i) => i.hasXp);
}

/** Accessory unlocked when reaching a level. */
export const LEVEL_REWARDS: Readonly<Record<number, string>> = {
  2: 'accessory_1',
  3: 'accessory_2',
};

/** Levels to congratulate: above the best level ever reached, up to the current one. */
export function newlyReachedLevels(bestLevel: number, level: number): number[] {
  const levels: number[] = [];
  for (let l = bestLevel + 1; l <= level; l++) levels.push(l);
  return levels;
}
