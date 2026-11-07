import { type Db, sql } from '@ovimuu/db';

export interface Stats {
  users: number;
  activeUsers: number;
  remindersSent: number;
  remindersAnswered: number;
  medianResponseMin: number | null;
  notMarked: number;
  avgDraftEdits: number | null;
  aiFeedback: number;
}

/** Aggregate counters for /stats. `since` = null → all time. Counts only, no medical data. */
export async function collectStats(db: Db, since: Date | null): Promise<Stats> {
  const from = since ?? new Date(0);
  const result = await db.execute(sql`
    select
      (select count(*) from users)::int as users,
      (select count(distinct user_id) from active_days
        where date >= (${from.toISOString()}::timestamptz)::date)::int as active_users,
      (select count(*) from reminders where sent_at >= ${from.toISOString()})::int as reminders_sent,
      (select count(*) from reminders r where r.sent_at >= ${from.toISOString()}
        and exists (select 1 from intakes i where i.reminder_id = r.id
                    and i.status in ('taken', 'skipped')))::int as reminders_answered,
      (select percentile_cont(0.5) within group (
          order by extract(epoch from (i.confirmed_at - i.scheduled_at)) / 60)
        from intakes i
        where i.reminder_id is not null and i.confirmed_at is not null
          and i.status in ('taken', 'skipped') and i.scheduled_at >= ${from.toISOString()}
      )::float as median_response_min,
      (select count(*) from intakes where status = 'not_marked'
        and scheduled_at >= ${from.toISOString()})::int as not_marked,
      (select avg(coalesce((payload->>'editCount')::int, 0)) from drafts
        where kind = 'add' and status = 'confirmed' and created_at >= ${from.toISOString()}
      )::float as avg_draft_edits,
      (select count(*) from ai_feedback where created_at >= ${from.toISOString()})::int as ai_feedback
  `);
  const r = result.rows[0] as Record<string, number | null>;
  return {
    users: r.users ?? 0,
    activeUsers: r.active_users ?? 0,
    remindersSent: r.reminders_sent ?? 0,
    remindersAnswered: r.reminders_answered ?? 0,
    medianResponseMin: r.median_response_min ?? null,
    notMarked: r.not_marked ?? 0,
    avgDraftEdits: r.avg_draft_edits ?? null,
    aiFeedback: r.ai_feedback ?? 0,
  };
}
