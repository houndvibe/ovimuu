// Free-text routing (routeIntent) and schedule changes by phrase:
// target selection → missing parameter → "было → станет" preview → confirm.
// "Выпила магний" is applied right away with a 10-minute undo.
import type { ParsedSlot } from '@ovimuu/ai';
import { Composer, InlineKeyboard } from 'grammy';
import { startAddFromText } from '../add/handlers.ts';
import type { BotContext } from '../context.ts';
import { ANCHOR_KEYS, isAnchorKey } from '../domain/anchors.ts';
import { addDays } from '../domain/dates.ts';
import {
  applyChange,
  type ChangeIntent,
  isChangeIntent,
  MARK_UNDO_WINDOW_MS,
  type MedState,
  missingParam,
  paramsFromIntent,
  pickIntakeToMark,
  toDraftMed,
} from '../domain/change.ts';
import { anchorSlot, exactTimeSlot } from '../domain/draft.ts';
import { localToUtc } from '../domain/intakes.ts';
import { parseAmount, parseClockTime } from '../domain/parse-input.ts';
import { DAY_BONUS_XP } from '../domain/xp.ts';
import { type Source, type UserClock, userClock, withAi } from '../flow.ts';
import { logger } from '../logger.ts';
import { awardForIntakes, intakeXp, revokeForIntakes } from '../progress/award.ts';
import { refreshReminderMessage } from '../reminders/refresh.ts';
import {
  applyMedChange,
  type ChangeDraft,
  type ChangePayload,
  createAdHocTaken,
  createChangeDraft,
  deleteIntake,
  findOpenIntakesInRange,
  getChangeDraftById,
  getIntakeReminderIds,
  getOpenChangeDraft,
  listActiveMeds,
  type MarkedIntake,
  saveChangeDraft,
} from '../repo/meds.ts';
import { saveAiFeedback } from '../repo/drafts.ts';
import { setIntakeStatus } from '../repo/reminders.ts';
import { regenerateForUser } from '../scheduling/generate.ts';
import { texts } from '../texts.ts';
import { markChosen } from '../ui.ts';

const t = texts.change;

// Callback data: "c:<draftId>:<seq>:<action>[:<arg>]".
const changeCallbackPattern = /^c:(\d+):(\d+):(\w+)(?::(\w+))?$/;
const data = (d: ChangeDraft, action: string, arg?: string | number) =>
  `c:${d.id}:${d.payload.seq}:${action}${arg !== undefined ? `:${arg}` : ''}`;

const emptyParams = () => ({
  slots: null,
  unitsPerIntake: null,
  pauseUntil: null,
  pauseIndefinite: false,
});

// ---------- Routing ----------

/** Free text with no open add-draft: classify with routeIntent and dispatch. */
export async function routeFreeText(
  ctx: BotContext,
  text: string,
  source: Source,
  clock: UserClock,
): Promise<void> {
  const meds = await listActiveMeds(ctx.db, ctx.user.id);
  const summaries = meds.map((m) => ({
    id: m.medicationId,
    name: m.name,
    schedule: t.medSummary(toDraftMed(m), clock.anchors, m.status === 'paused'),
  }));
  const result = await withAi(ctx, source, () => ctx.ai.routeIntent(text, summaries, clock.today));
  if (!result) return;
  logger.info(
    { userId: ctx.user.id, intent: result.intent, targets: result.targets.length },
    'intent routed',
  );

  if (result.intent === 'add') return startAddFromText(ctx, text, source, clock);
  if (result.intent === 'other') {
    await ctx.reply(result.otherKind === 'medical' ? t.medical : t.chat);
    return;
  }
  if (meds.length === 0) {
    await ctx.reply(t.noMeds);
    return;
  }

  const intent = result.intent;
  const payload: ChangePayload = {
    intent,
    candidates: result.targets.length > 0 ? result.targets : meds.map((m) => m.medicationId),
    medicationId: result.targets.length === 1 ? result.targets[0]! : null,
    params: isChangeIntent(intent) ? paramsFromIntent(result, clock.today) : emptyParams(),
    awaiting: null,
    seq: 0,
    inputText: text,
    intentResult: result,
  };

  if (intent === 'mark_taken' && result.targets.length > 0) {
    return markTaken(ctx, result.targets, meds, clock);
  }
  const draft = await createChangeDraft(ctx.db, ctx.user.id, payload);
  await advanceChange(ctx, draft, clock, meds);
}

// ---------- Change flow ----------

async function prompt(ctx: BotContext, draft: ChangeDraft, text: string, kb?: InlineKeyboard) {
  await saveChangeDraft(ctx.db, draft);
  await ctx.reply(text, kb ? { reply_markup: kb } : {});
}

async function advanceChange(
  ctx: BotContext,
  draft: ChangeDraft,
  clock: UserClock,
  meds?: MedState[],
): Promise<void> {
  const p = draft.payload;
  const all = meds ?? (await listActiveMeds(ctx.db, ctx.user.id));
  p.seq += 1;

  if (p.medicationId === null) {
    const options = all.filter((m) => p.candidates.includes(m.medicationId));
    const kb = new InlineKeyboard();
    (options.length ? options : all).forEach((m, i) => {
      kb.text(m.name, data(draft, 'm', m.medicationId));
      if (i % 2 === 1) kb.row();
    });
    p.awaiting = 'target';
    return prompt(ctx, draft, t.askWhichMed, kb);
  }

  const med = all.find((m) => m.medicationId === p.medicationId);
  if (!med) {
    await saveChangeDraft(ctx.db, draft, 'cancelled');
    await ctx.reply(t.stale);
    return;
  }
  if (p.intent === 'mark_taken') return markTaken(ctx, [med.medicationId], all, clock, draft);

  const intent = p.intent as ChangeIntent;
  if (intent === 'resume' && med.status !== 'paused') {
    await saveChangeDraft(ctx.db, draft, 'cancelled');
    await ctx.reply(t.notPaused(med.name));
    return;
  }

  const missing = missingParam(intent, p.params);
  if (missing === 'slot') {
    const kb = new InlineKeyboard();
    ANCHOR_KEYS.forEach((anchor, i) => {
      kb.text(texts.add.slotButton(anchor, clock.anchors), data(draft, 's', anchor));
      if (i % 2 === 1) kb.row();
    });
    kb.text(texts.add.customTimeButton, data(draft, 's', 'time'));
    p.awaiting = 'slot';
    return prompt(ctx, draft, t.askTime(med.name), kb);
  }
  if (missing === 'units') {
    const kb = new InlineKeyboard();
    for (const n of [1, 2, 3]) kb.text(texts.add.unitsButton(n, med.unitForm), data(draft, 'u', n));
    kb.row().text(texts.add.otherButton, data(draft, 'u', 'other'));
    p.awaiting = 'units';
    return prompt(ctx, draft, t.askUnits(med.name), kb);
  }
  if (missing === 'pause') {
    const kb = new InlineKeyboard()
      .text(t.pauseButtons.days3, data(draft, 'p', 3))
      .text(t.pauseButtons.week, data(draft, 'p', 7))
      .row()
      .text(t.pauseButtons.indefinite, data(draft, 'p', 'inf'));
    p.awaiting = 'pause';
    return prompt(ctx, draft, t.askPause(med.name), kb);
  }

  const before = toDraftMed(med);
  const after = toDraftMed(applyChange(med, intent, p.params));
  const preview = {
    change_time: () => t.previewTime(med.name, before, after, clock.anchors),
    change_amount: () => t.previewUnits(med.name, before, after),
    pause: () =>
      t.previewPause(med.name, p.params.pauseIndefinite ? null : p.params.pauseUntil, clock.today),
    resume: () => t.previewResume(med.name),
    complete: () => t.previewComplete(med.name),
    delete: () => t.previewDelete(med.name),
  }[intent]();
  const kb = new InlineKeyboard()
    .text(t.confirmButton, data(draft, 'ok'))
    .text(t.cancelButton, data(draft, 'cancel'))
    .row()
    .text(texts.feedback.button, data(draft, 'fb'));
  p.awaiting = 'confirm';
  return prompt(ctx, draft, preview, kb);
}

/**
 * A typed answer while a change draft waits for one ("Своё время", "Другое").
 * Returns false if the text is not an answer — the caller then routes it as new input.
 */
export async function tryChangeTypedAnswer(
  ctx: BotContext,
  draft: ChangeDraft,
  text: string,
  clock: UserClock,
): Promise<boolean> {
  const p = draft.payload;
  if (p.awaiting === 'slot_typed' || p.awaiting === 'slot') {
    const minutes = parseClockTime(text);
    if (minutes !== null) {
      p.params.slots = [exactTimeSlot(minutes)];
      await advanceChange(ctx, draft, clock);
      return true;
    }
    if (p.awaiting === 'slot_typed') {
      await ctx.reply(`${texts.add.notUnderstood} ${texts.add.askTimeTyped}`);
      return true;
    }
  }
  if (p.awaiting === 'units_typed' || p.awaiting === 'units') {
    const n = parseAmount(text);
    if (n !== null) {
      p.params.unitsPerIntake = n;
      await advanceChange(ctx, draft, clock);
      return true;
    }
    if (p.awaiting === 'units_typed') {
      await ctx.reply(`${texts.add.notUnderstood} ${texts.add.askUnitsTyped}`);
      return true;
    }
  }
  return false;
}

export { getOpenChangeDraft };

// ---------- Mark taken by phrase ----------

async function markTaken(
  ctx: BotContext,
  medIds: number[],
  meds: MedState[],
  clock: UserClock,
  existing?: ChangeDraft,
): Promise<void> {
  const now = new Date();
  const dayStart = localToUtc(clock.today, 0, clock.timezone);
  const dayEnd = localToUtc(addDays(clock.today, 1), 0, clock.timezone);
  const marked: MarkedIntake[] = [];
  const names: string[] = [];

  for (const medId of new Set(medIds)) {
    const med = meds.find((m) => m.medicationId === medId);
    if (!med) continue;
    names.push(med.name);
    const open = await findOpenIntakesInRange(ctx.db, ctx.user.id, medId, dayStart, dayEnd);
    const pick = pickIntakeToMark(open, now);
    if (pick !== null) {
      const prev = open.find((o) => o.id === pick)!.status as 'pending' | 'snoozed';
      await setIntakeStatus(ctx.db, [pick], ['pending', 'snoozed'], 'taken', now);
      marked.push({ intakeId: pick, prevStatus: prev });
    } else {
      // Nothing scheduled today: an ad-hoc intake (never earns XP).
      marked.push({
        intakeId: await createAdHocTaken(ctx.db, ctx.user.id, medId, now),
        prevStatus: null,
      });
    }
  }
  if (marked.length === 0) {
    await ctx.reply(t.stale);
    return;
  }

  const ids = marked.map((m) => m.intakeId);
  const change = await awardForIntakes(ctx.db, ctx.user.id, ids, clock.timezone);
  await refreshReminders(ctx, ids, clock);

  const payload: ChangePayload = {
    ...(existing?.payload ?? {
      intent: 'mark_taken',
      candidates: medIds,
      medicationId: null,
      params: emptyParams(),
      awaiting: null,
      seq: 0,
    }),
    marked,
    markedAt: now.toISOString(),
    seq: (existing?.payload.seq ?? 0) + 1,
  };
  const draft = existing
    ? { ...existing, payload }
    : await createChangeDraft(ctx.db, ctx.user.id, payload, 'confirmed');
  if (existing) await saveChangeDraft(ctx.db, draft, 'confirmed');
  logger.info({ userId: ctx.user.id, count: ids.length }, 'marked taken by phrase');

  const xp = await intakeXp(ctx.db, ids);
  await ctx.reply(t.markedTaken(names, xp), {
    reply_markup: new InlineKeyboard().text(t.markUndoButton, data(draft, 'undo')),
  });
  for (let i = 0; i < change.dayBonuses; i++)
    await ctx.reply(texts.progress.dayBonus(DAY_BONUS_XP));
  for (const up of change.levelUps) await ctx.reply(texts.progress.levelUp(up.level, up.reward));
}

async function refreshReminders(ctx: BotContext, intakeIds: number[], clock: UserClock) {
  for (const reminderId of await getIntakeReminderIds(ctx.db, intakeIds)) {
    await refreshReminderMessage(ctx, ctx.user.id, ctx.chat!.id, reminderId, clock.timezone);
  }
}

// ---------- Buttons ----------

export const changeButtons = new Composer<BotContext>();

changeButtons.callbackQuery(changeCallbackPattern, async (ctx) => {
  const [, idStr, seqStr, action, arg] = ctx.match;
  const draft = await getChangeDraftById(ctx.db, ctx.user.id, Number(idStr));
  const clock = await userClock(ctx);
  const stale = () => ctx.answerCallbackQuery(t.stale);

  // "ИИ ошибся" on a change preview (works even after confirm/cancel, once).
  if (action === 'fb' && draft) {
    if (!draft.payload.feedbackSent) {
      await saveAiFeedback(
        ctx.db,
        ctx.user.id,
        'intent',
        draft.payload.inputText ?? null,
        draft.payload.intentResult,
      );
      draft.payload.feedbackSent = true;
      await saveChangeDraft(ctx.db, draft);
      logger.info({ userId: ctx.user.id, draftId: draft.id }, 'ai feedback saved');
    }
    await ctx.answerCallbackQuery(texts.feedback.thanks);
    return;
  }

  if (!draft || draft.payload.seq !== Number(seqStr)) return stale();
  const p = draft.payload;

  // Undo of "выпила магний" (draft is already confirmed).
  if (action === 'undo') {
    if (!p.marked || p.undone || !p.markedAt) return stale();
    if (Date.now() - Date.parse(p.markedAt) > MARK_UNDO_WINDOW_MS) {
      await ctx.answerCallbackQuery(t.markUndoExpired);
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      return;
    }
    const ids = p.marked.map((m) => m.intakeId);
    await revokeForIntakes(ctx.db, ctx.user.id, ids, clock.timezone);
    for (const m of p.marked) {
      if (m.prevStatus === null) await deleteIntake(ctx.db, m.intakeId);
      else await setIntakeStatus(ctx.db, [m.intakeId], ['taken'], m.prevStatus, null);
    }
    await refreshReminders(ctx, ids, clock);
    p.undone = true;
    await saveChangeDraft(ctx.db, draft);
    logger.info({ userId: ctx.user.id, count: ids.length }, 'mark by phrase undone');
    await ctx.answerCallbackQuery();
    await markChosen(ctx, t.markUndone);
    return;
  }

  if (draft.status !== 'open') return stale();
  const choose = async (label: string) => {
    await ctx.answerCallbackQuery();
    await markChosen(ctx, texts.add.chosen(label));
  };

  if (action === 'm' && p.awaiting === 'target') {
    const medId = Number(arg);
    const meds = await listActiveMeds(ctx.db, ctx.user.id);
    const med = meds.find((m) => m.medicationId === medId);
    if (!med) return stale();
    await choose(med.name);
    p.medicationId = medId;
    return advanceChange(ctx, draft, clock, meds);
  }

  if (action === 's' && p.awaiting === 'slot') {
    if (arg === 'time') {
      p.awaiting = 'slot_typed';
      await saveChangeDraft(ctx.db, draft);
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      await ctx.reply(texts.add.askTimeTyped);
      return;
    }
    if (!arg || !isAnchorKey(arg)) return stale();
    await choose(texts.add.slotButton(arg, clock.anchors));
    p.params.slots = [anchorSlot(arg) as ParsedSlot];
    return advanceChange(ctx, draft, clock);
  }

  if (action === 'u' && p.awaiting === 'units') {
    if (arg === 'other') {
      p.awaiting = 'units_typed';
      await saveChangeDraft(ctx.db, draft);
      await ctx.answerCallbackQuery();
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      await ctx.reply(texts.add.askUnitsTyped);
      return;
    }
    const n = Number(arg);
    if (!(n >= 1 && n <= 3)) return stale();
    await choose(String(n));
    p.params.unitsPerIntake = n;
    return advanceChange(ctx, draft, clock);
  }

  if (action === 'p' && p.awaiting === 'pause') {
    if (arg === 'inf') {
      p.params.pauseIndefinite = true;
      await choose(t.pauseButtons.indefinite);
    } else {
      const days = Number(arg);
      if (days !== 3 && days !== 7) return stale();
      p.params.pauseUntil = addDays(clock.today, days);
      await choose(days === 3 ? t.pauseButtons.days3 : t.pauseButtons.week);
    }
    return advanceChange(ctx, draft, clock);
  }

  if ((action === 'ok' || action === 'cancel') && p.awaiting === 'confirm') {
    await ctx.answerCallbackQuery();
    if (action === 'cancel') {
      await saveChangeDraft(ctx.db, draft, 'cancelled');
      await markChosen(ctx, t.cancelled);
      return;
    }
    const med = (await listActiveMeds(ctx.db, ctx.user.id)).find(
      (m) => m.medicationId === p.medicationId,
    );
    if (!med || !isChangeIntent(p.intent)) return;
    await applyMedChange(ctx.db, med, p.intent, p.params, new Date());
    await saveChangeDraft(ctx.db, draft, 'confirmed');
    await regenerateForUser(ctx.db, ctx.user.id);
    logger.info({ userId: ctx.user.id, intent: p.intent }, 'schedule change applied');
    await markChosen(ctx, t.applied);
    return;
  }

  return stale();
});
