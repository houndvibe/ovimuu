import type { ParseResult } from '@ovimuu/ai';
import { Composer } from 'grammy';
import type { BotContext } from '../context.ts';
import { ANCHOR_KEYS, isAnchorKey } from '../domain/anchors.ts';
import {
  anchorSlot,
  applyFrequency,
  applyMealPreset,
  applyName,
  applySlot,
  applyUnits,
  applyWeekdays,
  type DraftMed,
  draftToRecords,
  exactTimeSlot,
  nextQuestion,
  type Question,
  splitUnsupported,
  toggleWeekday,
} from '../domain/draft.ts';
import { parseAmount, parseClockTime } from '../domain/parse-input.ts';
import { type Source, type UserClock, userClock, withAi } from '../flow.ts';
import { logger } from '../logger.ts';
import {
  closeDraft,
  confirmDraft,
  createDraft,
  type Draft,
  getOpenDraft,
  saveAiFeedback,
  saveDraft,
} from '../repo/drafts.ts';
import { regenerateForUser } from '../scheduling/generate.ts';
import { downloadFile } from '../telegram-files.ts';
import { texts } from '../texts.ts';
import { markChosen } from '../ui.ts';
import { cardKeyboard, draftCallbackPattern, questionKeyboard } from './keyboards.ts';

const t = texts.add;
// ---------- Prompts ----------

const medName = (m: DraftMed | undefined) => m?.name ?? 'Препарат';

function questionText(q: Question, meds: DraftMed[]): string {
  const name = medName(meds[q.med]);
  switch (q.kind) {
    case 'name':
      return t.askName;
    case 'frequency':
      return t.askFrequency(name);
    case 'weekdays':
      return t.askWeekdays(name);
    case 'units':
      return t.askUnits(name);
    case 'slot':
      return t.askSlot(name, q.index, q.total);
  }
}

function cardText(meds: DraftMed[], clock: UserClock): string {
  const cards = meds.map((m) => t.medCard(m, clock.anchors, clock.today));
  return [t.cardHeader, ...cards].join('\n\n');
}

/**
 * Moves the draft forward: explains unsupported schemes, then asks the next missing
 * field or shows the confirmation card. Every prompt bumps `seq`.
 */
async function advance(ctx: BotContext, draft: Draft, clock: UserClock): Promise<void> {
  const { supported, unsupported } = splitUnsupported(draft.payload.meds);
  for (const u of unsupported) await ctx.reply(t.unsupported(u.name, u.reason));

  if (supported.length === 0) {
    await closeDraft(ctx.db, draft.id, 'cancelled');
    if (unsupported.length === 0) await ctx.reply(t.nothingFound);
    logger.info({ userId: ctx.user.id, draftId: draft.id }, 'draft closed: nothing to add');
    return;
  }

  const p = draft.payload;
  p.meds = supported;
  p.seq += 1;
  const q = nextQuestion(supported);
  if (q) {
    p.awaiting = { type: 'question', question: q, textInput: q.kind === 'name' };
    await saveDraft(ctx.db, draft);
    const keyboard = questionKeyboard(q, supported[q.med]!, clock.anchors, draft.id, p.seq);
    await ctx.reply(questionText(q, supported), keyboard ? { reply_markup: keyboard } : {});
  } else {
    p.awaiting = null;
    await saveDraft(ctx.db, draft);
    await ctx.reply(cardText(supported, clock), { reply_markup: cardKeyboard(draft.id, p.seq) });
  }
}

// ---------- Inputs ----------

async function startOrExtend(
  ctx: BotContext,
  result: ParseResult,
  clock: UserClock,
  append: boolean,
  /** User text / transcript (null for photos: OCR text is never stored). */
  input: string | null,
) {
  const existing = append ? await getOpenDraft(ctx.db, ctx.user.id) : null;
  if (existing) {
    existing.payload.meds = [...existing.payload.meds, ...result.medications];
    existing.payload.modelOutput = result;
    await advance(ctx, existing, clock);
    return;
  }
  const draft = await createDraft(ctx.db, ctx.user.id, {
    meds: result.medications,
    awaiting: null,
    seq: 0,
    editCount: 0,
    inputs: input ? [input] : [],
    modelOutput: result,
  });
  logger.info(
    { userId: ctx.user.id, draftId: draft.id, meds: result.medications.length },
    'draft created',
  );
  await advance(ctx, draft, clock);
}

/**
 * A typed answer to the current question. Returns false if the text is not an answer
 * (then it is treated as a correction), true if handled.
 */
async function tryTypedAnswer(
  ctx: BotContext,
  draft: Draft,
  text: string,
  clock: UserClock,
): Promise<boolean> {
  const awaiting = draft.payload.awaiting;
  if (awaiting?.type !== 'question') return false;
  const { question: q, textInput } = awaiting;
  const meds = draft.payload.meds;

  let updated: DraftMed[] | null = null;
  if (q.kind === 'name' && text.trim().length > 0 && text.trim().length <= 80) {
    updated = applyName(meds, q.med, text);
  } else if (q.kind === 'units') {
    const n = parseAmount(text);
    if (n !== null) updated = applyUnits(meds, q.med, n);
  } else if (q.kind === 'slot') {
    const minutes = parseClockTime(text);
    if (minutes !== null) updated = applySlot(meds, q.med, exactTimeSlot(minutes));
  }

  if (updated) {
    draft.payload.meds = updated;
    await advance(ctx, draft, clock);
    return true;
  }
  if (textInput) {
    const hint =
      q.kind === 'units' ? t.askUnitsTyped : q.kind === 'slot' ? t.askTimeTyped : t.askName;
    await ctx.reply(`${t.notUnderstood} ${hint}`);
    return true;
  }
  return false;
}

/** Text while an add-draft is open: a typed answer, otherwise a correction via AI. */
export async function continueAddDraft(
  ctx: BotContext,
  draft: Draft,
  text: string,
  source: Source,
  clock: UserClock,
): Promise<void> {
  if (await tryTypedAnswer(ctx, draft, text, clock)) return;
  const result = await withAi(ctx, source, () =>
    ctx.ai.parseMedications(text, {
      today: clock.today,
      currentDraft: { medications: draft.payload.meds },
    }),
  );
  if (!result) return;
  draft.payload.meds = result.medications;
  draft.payload.editCount += 1;
  draft.payload.inputs = [...(draft.payload.inputs ?? []), text];
  draft.payload.modelOutput = result;
  logger.info({ userId: ctx.user.id, draftId: draft.id }, 'draft corrected');
  await advance(ctx, draft, clock);
}

/** New medications from free text (intent "add" or no router). */
export async function startAddFromText(
  ctx: BotContext,
  text: string,
  source: Source,
  clock: UserClock,
): Promise<void> {
  const result = await withAi(ctx, source, () =>
    ctx.ai.parseMedications(text, { today: clock.today }),
  );
  if (result) await startOrExtend(ctx, result, clock, false, text);
}

/** Photo of a prescription; while a draft is open the found medications are appended. */
export async function addFromPhoto(ctx: BotContext, fileId: string): Promise<void> {
  const clock = await userClock(ctx);
  // The image and OCR text live only in memory here and are never stored.
  const result = await withAi(ctx, 'photo', async () => {
    const ocrText = await ctx.ai.ocr(await downloadFile(ctx, fileId));
    return ctx.ai.parseMedications(ocrText, { today: clock.today });
  });
  if (result) await startOrExtend(ctx, result, clock, true, null);
}

export const addFlow = new Composer<BotContext>();

// ---------- Buttons ----------

addFlow.callbackQuery(draftCallbackPattern, async (ctx) => {
  const [, draftId, seq, action] = ctx.match;
  const draft = await getOpenDraft(ctx.db, ctx.user.id);

  // "ИИ ошибся" works on any card of the open draft, even an older one.
  if (action === 'fb' && draft && draft.id === Number(draftId)) {
    if (!draft.payload.feedbackSent) {
      await saveAiFeedback(
        ctx.db,
        ctx.user.id,
        'parse',
        draft.payload.inputs?.join('\n---\n') || null,
        draft.payload.modelOutput,
      );
      draft.payload.feedbackSent = true;
      await saveDraft(ctx.db, draft);
      logger.info({ userId: ctx.user.id, draftId: draft.id }, 'ai feedback saved');
    }
    await ctx.answerCallbackQuery(texts.feedback.thanks);
    return;
  }

  if (!draft || draft.id !== Number(draftId) || draft.payload.seq !== Number(seq) || !action) {
    await ctx.answerCallbackQuery(t.staleButton);
    return;
  }

  const p = draft.payload;
  const q = p.awaiting?.type === 'question' ? p.awaiting.question : null;
  const [kind, arg] = action.split(':') as [string, string | undefined];
  const stale = () => ctx.answerCallbackQuery(t.staleButton);

  // Confirmation card
  if (p.awaiting === null && (kind === 'ok' || kind === 'edit' || kind === 'cancel')) {
    await ctx.answerCallbackQuery();
    const clock = await userClock(ctx);
    if (kind === 'ok') {
      await confirmDraft(ctx.db, draft, draftToRecords(p.meds, clock.today));
      logger.info(
        { userId: ctx.user.id, draftId: draft.id, meds: p.meds.length, edits: p.editCount },
        'draft confirmed',
      );
      await regenerateForUser(ctx.db, ctx.user.id);
      await markChosen(ctx, t.cardSaved);
      await ctx.reply(t.saved);
    } else if (kind === 'edit') {
      p.awaiting = { type: 'correction' };
      p.seq += 1;
      await saveDraft(ctx.db, draft);
      await ctx.editMessageReplyMarkup().catch(() => undefined);
      await ctx.reply(t.askCorrection);
    } else {
      await closeDraft(ctx.db, draft.id, 'cancelled');
      logger.info({ userId: ctx.user.id, draftId: draft.id }, 'draft cancelled');
      await markChosen(ctx, t.cardCancelled);
      await ctx.reply(t.cancelled);
    }
    return;
  }

  if (!q) return stale();
  const clock = await userClock(ctx);
  const apply = async (meds: DraftMed[], label: string) => {
    await ctx.answerCallbackQuery();
    await markChosen(ctx, t.chosen(label));
    p.meds = meds;
    await advance(ctx, draft, clock);
  };
  const askTyped = async (hint: string) => {
    await ctx.answerCallbackQuery();
    p.awaiting = { type: 'question', question: q, textInput: true };
    await saveDraft(ctx.db, draft);
    await ctx.editMessageReplyMarkup().catch(() => undefined);
    await ctx.reply(hint);
  };

  if (kind === 'f' && q.kind === 'frequency') {
    const labels = t.frequencyButtons;
    if (arg === 'daily') return apply(applyFrequency(p.meds, q.med, 'daily'), labels.daily);
    if (arg === 'eod')
      return apply(applyFrequency(p.meds, q.med, 'every_other_day'), labels.everyOtherDay);
    if (arg === 'once') return apply(applyFrequency(p.meds, q.med, 'once'), labels.once);
    if (arg === 'wd') {
      await ctx.answerCallbackQuery();
      const wq: Question = { kind: 'weekdays', med: q.med, selected: [] };
      p.awaiting = { type: 'question', question: wq, textInput: false };
      p.seq += 1;
      await saveDraft(ctx.db, draft);
      const kb = questionKeyboard(wq, p.meds[q.med]!, clock.anchors, draft.id, p.seq);
      await ctx.editMessageText(questionText(wq, p.meds), { reply_markup: kb });
      return;
    }
  }

  if (kind === 'wd' && q.kind === 'weekdays') {
    if (arg === 'ok') {
      if (q.selected.length === 0) return ctx.answerCallbackQuery(t.weekdaysEmpty);
      const label = q.selected.map((d) => t.weekdayShort[d - 1]).join(', ');
      return apply(applyWeekdays(p.meds, q.med, q.selected), label);
    }
    const day = Number(arg);
    if (day >= 1 && day <= 7) {
      await ctx.answerCallbackQuery();
      const wq: Question = { ...q, selected: toggleWeekday(q.selected, day) };
      p.awaiting = { type: 'question', question: wq, textInput: false };
      await saveDraft(ctx.db, draft);
      const kb = questionKeyboard(wq, p.meds[q.med]!, clock.anchors, draft.id, p.seq);
      await ctx.editMessageReplyMarkup({ reply_markup: kb });
      return;
    }
  }

  if (kind === 'u' && q.kind === 'units') {
    if (arg === 'other') return askTyped(t.askUnitsTyped);
    const n = Number(arg);
    if (n >= 1 && n <= 3) {
      return apply(applyUnits(p.meds, q.med, n), t.unitsButton(n, p.meds[q.med]!.unitForm));
    }
  }

  if (kind === 's' && q.kind === 'slot') {
    if (arg === 'time') return askTyped(t.askTimeTyped);
    if (arg === 'preset' && q.mealPreset) {
      return apply(applyMealPreset(p.meds, q.med, q.mealPreset), t.mealPresetButton(q.mealPreset));
    }
    if (arg && isAnchorKey(arg) && ANCHOR_KEYS.includes(arg)) {
      return apply(applySlot(p.meds, q.med, anchorSlot(arg)), t.slotButton(arg, clock.anchors));
    }
  }

  return stale();
});
