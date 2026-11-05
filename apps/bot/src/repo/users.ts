import { type Db, eq, userProgress, users, userSettings } from '@ovimuu/db';
import { type Anchors, parseTime } from '../domain/anchors.ts';

export type User = typeof users.$inferSelect;
export type UserSettings = typeof userSettings.$inferSelect;
type UserPatch = Partial<Omit<typeof users.$inferInsert, 'id' | 'telegramId'>>;
type SettingsPatch = Partial<Omit<typeof userSettings.$inferInsert, 'userId'>>;

/** Finds the user by Telegram id or creates them (with settings and progress rows). */
export async function getOrCreateUser(
  db: Db,
  telegramId: number,
  firstName: string | null,
): Promise<User> {
  const [existing] = await db.select().from(users).where(eq(users.telegramId, telegramId));
  if (existing) return existing;

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(users)
      .values({ telegramId, firstName, onboardingStep: 'consent' })
      .onConflictDoNothing({ target: users.telegramId })
      .returning();
    if (!created) {
      // Lost a race with a concurrent insert.
      const [row] = await tx.select().from(users).where(eq(users.telegramId, telegramId));
      return row!;
    }
    await tx.insert(userSettings).values({ userId: created.id });
    await tx.insert(userProgress).values({ userId: created.id });
    return created;
  });
}

export async function updateUser(db: Db, userId: number, patch: UserPatch): Promise<User> {
  const [row] = await db.update(users).set(patch).where(eq(users.id, userId)).returning();
  return row!;
}

export async function getSettings(db: Db, userId: number): Promise<UserSettings> {
  const [row] = await db.select().from(userSettings).where(eq(userSettings.userId, userId));
  if (!row) throw new Error(`user_settings missing for user ${userId}`);
  return row;
}

export async function updateSettings(
  db: Db,
  userId: number,
  patch: SettingsPatch,
): Promise<UserSettings> {
  const [row] = await db
    .update(userSettings)
    .set(patch)
    .where(eq(userSettings.userId, userId))
    .returning();
  return row!;
}

export function settingsToAnchors(s: UserSettings): Anchors {
  return {
    wake: parseTime(s.wake),
    breakfast: parseTime(s.breakfast),
    lunch: parseTime(s.lunch),
    dinner: parseTime(s.dinner),
    sleep: parseTime(s.sleep),
  };
}
