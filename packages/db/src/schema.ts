import { sql } from 'drizzle-orm';
import {
  bigint,
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  timestamp,
  unique,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

// ---------- Enums ----------

export const frequencyType = pgEnum('frequency_type', [
  'daily',
  'every_n_days',
  'weekdays',
  'once',
]);
export const scheduleStatus = pgEnum('schedule_status', ['active', 'paused', 'completed']);
export const anchor = pgEnum('anchor', ['wake', 'breakfast', 'lunch', 'dinner', 'sleep']);
export const intakeStatus = pgEnum('intake_status', [
  'pending',
  'taken',
  'snoozed',
  'skipped',
  'not_marked',
]);
export const draftKind = pgEnum('draft_kind', ['add', 'change']);
export const draftStatus = pgEnum('draft_status', ['open', 'confirmed', 'cancelled', 'expired']);
export const xpEventKind = pgEnum('xp_event_kind', ['intake', 'day_complete']);

// ---------- Column helpers ----------

const id = () => integer('id').primaryKey().generatedAlwaysAsIdentity();
const createdAt = () => timestamp('created_at', { withTimezone: true }).notNull().defaultNow();
const userRef = () =>
  integer('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' });

// ---------- Tables ----------

export const users = pgTable('users', {
  id: id(),
  telegramId: bigint('telegram_id', { mode: 'number' }).notNull().unique(),
  firstName: text('first_name'),
  createdAt: createdAt(),
  consentAt: timestamp('consent_at', { withTimezone: true }),
  /** Current onboarding step; null means onboarding is complete. */
  onboardingStep: text('onboarding_step'),
});

export const userSettings = pgTable(
  'user_settings',
  {
    userId: integer('user_id')
      .primaryKey()
      .references(() => users.id, { onDelete: 'cascade' }),
    /** IANA time zone, e.g. "Europe/Moscow". */
    timezone: text('timezone').notNull().default('Europe/Moscow'),
    // Daily routine anchors, local time in the user's time zone.
    wake: time('wake').notNull().default('08:00'),
    breakfast: time('breakfast').notNull().default('09:00'),
    lunch: time('lunch').notNull().default('13:00'),
    dinner: time('dinner').notNull().default('19:00'),
    sleep: time('sleep').notNull().default('23:00'),
    repeatCount: smallint('repeat_count').notNull().default(1),
    repeatDelayMin: smallint('repeat_delay_min').notNull().default(30),
  },
  (t) => [
    check('user_settings_repeat_count_range', sql`${t.repeatCount} between 0 and 2`),
    check('user_settings_repeat_delay_positive', sql`${t.repeatDelayMin} > 0`),
  ],
);

export const medications = pgTable(
  'medications',
  {
    id: id(),
    userId: userRef(),
    name: text('name').notNull(),
    doseAmount: numeric('dose_amount'),
    /** mg, IU, ml, ... */
    doseUnit: text('dose_unit'),
    unitsPerIntake: numeric('units_per_intake').notNull(),
    /** tablet, capsule, drops, ... */
    unitForm: text('unit_form'),
    notes: text('notes'),
    /** Soft delete ("удали магний"): hidden everywhere, history and XP are kept. */
    deletedAt: timestamp('deleted_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [index('medications_user_id_idx').on(t.userId)],
);

export const schedules = pgTable(
  'schedules',
  {
    id: id(),
    medicationId: integer('medication_id')
      .notNull()
      .references(() => medications.id, { onDelete: 'cascade' }),
    frequencyType: frequencyType('frequency_type').notNull(),
    everyNDays: smallint('every_n_days'),
    /** ISO weekdays: 1 = Monday ... 7 = Sunday. */
    weekdays: smallint('weekdays').array(),
    startDate: date('start_date').notNull(),
    /** Null means indefinite. */
    endDate: date('end_date'),
    status: scheduleStatus('status').notNull().default('active'),
    pausedUntil: date('paused_until'),
    createdAt: createdAt(),
  },
  (t) => [
    index('schedules_medication_id_idx').on(t.medicationId),
    check(
      'schedules_every_n_days_valid',
      sql`(${t.frequencyType} = 'every_n_days') = coalesce(${t.everyNDays} >= 2, false)`,
    ),
    check(
      'schedules_weekdays_valid',
      sql`(${t.frequencyType} = 'weekdays') = coalesce(cardinality(${t.weekdays}) > 0, false)`,
    ),
    check('schedules_end_after_start', sql`${t.endDate} is null or ${t.endDate} >= ${t.startDate}`),
  ],
);

export const scheduleSlots = pgTable(
  'schedule_slots',
  {
    id: id(),
    scheduleId: integer('schedule_id')
      .notNull()
      .references(() => schedules.id, { onDelete: 'cascade' }),
    /** Exact local time; mutually exclusive with anchor. */
    time: time('time'),
    anchor: anchor('anchor'),
    /** Offset from the anchor in minutes, e.g. +30 = "half an hour after breakfast". */
    anchorOffsetMin: smallint('anchor_offset_min').notNull().default(0),
  },
  (t) => [
    index('schedule_slots_schedule_id_idx').on(t.scheduleId),
    check('schedule_slots_time_xor_anchor', sql`(${t.time} is null) <> (${t.anchor} is null)`),
  ],
);

export const intakes = pgTable(
  'intakes',
  {
    id: id(),
    userId: userRef(),
    medicationId: integer('medication_id')
      .notNull()
      .references(() => medications.id, { onDelete: 'cascade' }),
    /** Null for ad-hoc "taken now" intakes (these never earn XP). */
    scheduleId: integer('schedule_id').references(() => schedules.id, { onDelete: 'cascade' }),
    // SET NULL: replacing slots on a time change must not erase intake history.
    slotId: integer('slot_id').references(() => scheduleSlots.id, { onDelete: 'set null' }),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    status: intakeStatus('status').notNull().default('pending'),
    confirmedAt: timestamp('confirmed_at', { withTimezone: true }),
    /** The reminder message this intake was sent in (shared by intakes due at the same time). */
    reminderId: integer('reminder_id').references(() => reminders.id, { onDelete: 'set null' }),
    createdAt: createdAt(),
  },
  (t) => [
    // Makes intake generation idempotent. NULL slot_id (ad-hoc intakes) is never deduplicated.
    unique('intakes_slot_scheduled_at_uq').on(t.slotId, t.scheduledAt),
    index('intakes_user_scheduled_at_idx').on(t.userId, t.scheduledAt),
    index('intakes_reminder_id_idx').on(t.reminderId),
  ],
);

/** One reminder message in the chat, grouping intakes due at the same time. */
export const reminders = pgTable(
  'reminders',
  {
    id: id(),
    userId: userRef(),
    scheduledAt: timestamp('scheduled_at', { withTimezone: true }).notNull(),
    /** Telegram message id of the current reminder message (changes after a snooze resend). */
    messageId: integer('message_id'),
    sentAt: timestamp('sent_at', { withTimezone: true }),
    repeatsSent: smallint('repeats_sent').notNull().default(0),
    /** When to send the next "Ови напоминает" reply; null = no more repeats. */
    repeatAt: timestamp('repeat_at', { withTimezone: true }),
    /** "Позже": when to resend the reminder. */
    snoozedUntil: timestamp('snoozed_until', { withTimezone: true }),
    /** All intakes answered (or sending failed); no more repeats or resends. */
    closedAt: timestamp('closed_at', { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    index('reminders_repeat_at_idx').on(t.repeatAt),
    index('reminders_snoozed_until_idx').on(t.snoozedUntil),
  ],
);

export const drafts = pgTable(
  'drafts',
  {
    id: id(),
    userId: userRef(),
    kind: draftKind('kind').notNull(),
    payload: jsonb('payload').notNull(),
    status: draftStatus('status').notNull().default('open'),
    expiresAt: timestamp('expires_at', { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '24 hours'`),
    createdAt: createdAt(),
  },
  (t) => [index('drafts_user_status_idx').on(t.userId, t.status)],
);

export const xpEvents = pgTable(
  'xp_events',
  {
    id: id(),
    userId: userRef(),
    kind: xpEventKind('kind').notNull(),
    intakeId: integer('intake_id').references(() => intakes.id, { onDelete: 'cascade' }),
    /** Local calendar date (user's time zone) for day_complete bonuses. */
    date: date('date'),
    amount: integer('amount').notNull(),
    createdAt: createdAt(),
  },
  (t) => [
    // XP is awarded exactly once per intake / per day — enforced by the database, not code.
    uniqueIndex('xp_events_intake_uq')
      .on(t.intakeId)
      .where(sql`${t.kind} = 'intake'`),
    uniqueIndex('xp_events_day_complete_uq')
      .on(t.userId, t.date)
      .where(sql`${t.kind} = 'day_complete'`),
    check(
      'xp_events_kind_fields',
      sql`(${t.kind} = 'intake' and ${t.intakeId} is not null and ${t.date} is null) or (${t.kind} = 'day_complete' and ${t.date} is not null and ${t.intakeId} is null)`,
    ),
    check('xp_events_amount_positive', sql`${t.amount} > 0`),
  ],
);

export const userProgress = pgTable('user_progress', {
  userId: integer('user_id')
    .primaryKey()
    .references(() => users.id, { onDelete: 'cascade' }),
  xpTotal: integer('xp_total').notNull().default(0),
  /** Current level, always recomputed from xp_total (may drop after an undo). */
  level: integer('level').notNull().default(1),
  /** Highest level ever reached: level-up congratulations are sent only above it. */
  bestLevel: integer('best_level').notNull().default(1),
  /** Cumulative counter of active_days, never decreases. */
  daysWithOvi: integer('days_with_ovi').notNull().default(0),
});

/** Local dates on which the user marked at least one intake. Rows are never deleted. */
export const activeDays = pgTable(
  'active_days',
  {
    userId: userRef(),
    date: date('date').notNull(),
  },
  (t) => [primaryKey({ columns: [t.userId, t.date] })],
);

export const unlocks = pgTable(
  'unlocks',
  {
    userId: userRef(),
    itemKey: text('item_key').notNull(),
    unlockedAt: timestamp('unlocked_at', { withTimezone: true }).notNull().defaultNow(),
    equipped: boolean('equipped').notNull().default(false),
  },
  (t) => [primaryKey({ columns: [t.userId, t.itemKey] })],
);

/** "AI was wrong" reports. Raw input is stored only on explicit user action. */
export const aiFeedback = pgTable(
  'ai_feedback',
  {
    id: id(),
    userId: userRef(),
    kind: text('kind').notNull(),
    inputText: text('input_text'),
    modelOutput: jsonb('model_output'),
    createdAt: createdAt(),
  },
  (t) => [index('ai_feedback_user_id_idx').on(t.userId)],
);
