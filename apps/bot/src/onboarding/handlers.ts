import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { Composer, InputFile } from 'grammy';
import type { BotContext } from '../context.ts';
import { isAnchorKey, shiftTime, toDbTime, validateAnchors } from '../domain/anchors.ts';
import { formatLocalTime, formatUtcOffset, parseTimeZoneInput } from '../domain/timezone.ts';
import { logger } from '../logger.ts';
import {
  getSettings,
  settingsToAnchors,
  updateSettings,
  updateUser,
  type User,
} from '../repo/users.ts';
import { texts } from '../texts.ts';
import {
  anchorShiftPattern,
  anchorsEditorKeyboard,
  anchorsKeyboard,
  cb,
  consentKeyboard,
  timezoneBackKeyboard,
  timezoneKeyboard,
} from './keyboards.ts';

const t = texts.onboarding;

/** Onboarding steps stored in users.onboarding_step; null means onboarding is complete. */
export type OnboardingStep = 'consent' | 'timezone' | 'timezone_custom' | 'anchors';

const greetImagePath = fileURLToPath(new URL('../../assets/ovi/greet.png', import.meta.url));

async function setStep(ctx: BotContext, step: OnboardingStep | null, extra: Partial<User> = {}) {
  ctx.user = await updateUser(ctx.db, ctx.user.id, { ...extra, onboardingStep: step });
  logger.info({ userId: ctx.user.id, step: step ?? 'complete' }, 'onboarding step');
}

/** Appends a "chosen" line to the pressed message and removes its keyboard. */
async function markChosen(ctx: BotContext, line: string) {
  const text = ctx.callbackQuery?.message?.text;
  try {
    if (text) await ctx.editMessageText(`${text}\n\n${line}`);
    else await ctx.editMessageReplyMarkup();
  } catch (err) {
    logger.warn({ err }, 'failed to edit onboarding message');
  }
}

async function sendGreeting(ctx: BotContext) {
  if (existsSync(greetImagePath)) {
    await ctx.replyWithPhoto(new InputFile(greetImagePath), { caption: t.greeting });
  } else {
    await ctx.reply(t.greeting);
  }
}

/** (Re)sends the prompt for the user's current onboarding step. */
export async function sendStepPrompt(ctx: BotContext): Promise<void> {
  const step = ctx.user.onboardingStep as OnboardingStep | null;
  switch (step) {
    case 'consent':
      await sendGreeting(ctx);
      await ctx.reply(t.consent, { reply_markup: consentKeyboard() });
      return;
    case 'timezone':
      await ctx.reply(t.timezonePrompt, { reply_markup: timezoneKeyboard(new Date()) });
      return;
    case 'timezone_custom':
      await ctx.reply(t.timezoneCustomPrompt, { reply_markup: timezoneBackKeyboard() });
      return;
    case 'anchors': {
      const anchors = settingsToAnchors(await getSettings(ctx.db, ctx.user.id));
      await ctx.reply(t.anchorsPrompt(anchors), { reply_markup: anchorsKeyboard() });
      return;
    }
    case null:
      return;
  }
}

async function completeOnboarding(ctx: BotContext) {
  await setStep(ctx, null);
  await ctx.reply(t.done);
}

/** Answers a button from a step the user is no longer on. Returns true if stale. */
async function rejectStale(ctx: BotContext, ...steps: OnboardingStep[]): Promise<boolean> {
  if (steps.includes(ctx.user.onboardingStep as OnboardingStep)) return false;
  await ctx.answerCallbackQuery(t.staleButton);
  return true;
}

export const onboarding = new Composer<BotContext>();

onboarding.command('start', async (ctx) => {
  if (ctx.user.onboardingStep === null) await ctx.reply(texts.welcomeBack);
  else await sendStepPrompt(ctx);
});

onboarding.callbackQuery(cb.noop, (ctx) => ctx.answerCallbackQuery());

// Step: consent
onboarding.callbackQuery(cb.consent, async (ctx) => {
  if (await rejectStale(ctx, 'consent')) return;
  await ctx.answerCallbackQuery();
  await markChosen(ctx, t.consentAccepted);
  await setStep(ctx, 'timezone', { consentAt: new Date() });
  await sendStepPrompt(ctx);
});

// Step: timezone
onboarding.callbackQuery(cb.tzOther, async (ctx) => {
  if (await rejectStale(ctx, 'timezone')) return;
  await ctx.answerCallbackQuery();
  await markChosen(ctx, t.timezoneOtherChosen);
  await setStep(ctx, 'timezone_custom');
  await sendStepPrompt(ctx);
});

onboarding.callbackQuery(cb.tzList, async (ctx) => {
  if (await rejectStale(ctx, 'timezone_custom')) return;
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup().catch(() => undefined);
  await setStep(ctx, 'timezone');
  await sendStepPrompt(ctx);
});

onboarding.callbackQuery(/^ob:tz:(.+)$/, async (ctx) => {
  if (await rejectStale(ctx, 'timezone', 'timezone_custom')) return;
  const preset = texts.timezonePresets.find((p) => p.tz === ctx.match[1]);
  if (!preset) return ctx.answerCallbackQuery();
  await ctx.answerCallbackQuery();
  await markChosen(ctx, t.timezoneChosen(preset.label));
  await updateSettings(ctx.db, ctx.user.id, { timezone: preset.tz });
  await setStep(ctx, 'anchors');
  await sendStepPrompt(ctx);
});

// Step: anchors
onboarding.callbackQuery(cb.anchorsOk, async (ctx) => {
  if (await rejectStale(ctx, 'anchors')) return;
  await ctx.answerCallbackQuery();
  await markChosen(ctx, t.anchorsOkChosen);
  await completeOnboarding(ctx);
});

onboarding.callbackQuery(cb.anchorsEdit, async (ctx) => {
  if (await rejectStale(ctx, 'anchors')) return;
  await ctx.answerCallbackQuery();
  const anchors = settingsToAnchors(await getSettings(ctx.db, ctx.user.id));
  await ctx.editMessageText(t.anchorsEditPrompt, { reply_markup: anchorsEditorKeyboard(anchors) });
});

onboarding.callbackQuery(anchorShiftPattern, async (ctx) => {
  if (await rejectStale(ctx, 'anchors')) return;
  const [, key, delta] = ctx.match;
  if (!key || !isAnchorKey(key)) return ctx.answerCallbackQuery();
  const current = settingsToAnchors(await getSettings(ctx.db, ctx.user.id));
  const value = shiftTime(current[key], Number(delta));
  const settings = await updateSettings(ctx.db, ctx.user.id, { [key]: toDbTime(value) });
  await ctx.answerCallbackQuery();
  await ctx.editMessageReplyMarkup({
    reply_markup: anchorsEditorKeyboard(settingsToAnchors(settings)),
  });
});

onboarding.callbackQuery(cb.anchorsDone, async (ctx) => {
  if (await rejectStale(ctx, 'anchors')) return;
  const anchors = settingsToAnchors(await getSettings(ctx.db, ctx.user.id));
  const check = validateAnchors(anchors);
  if (!check.ok) {
    await ctx.answerCallbackQuery({
      text: t.anchorsOrderError(check.before, check.after),
      show_alert: true,
    });
    return;
  }
  await ctx.answerCallbackQuery();
  await ctx.editMessageText(t.anchorsSaved(anchors));
  await completeOnboarding(ctx);
});

// Free-form messages while onboarding is in progress.
onboarding.on('message', async (ctx, next) => {
  const step = ctx.user.onboardingStep as OnboardingStep | null;
  if (step === null) return next();

  if (step === 'timezone_custom' && ctx.message.text) {
    const now = new Date();
    const tz = parseTimeZoneInput(ctx.message.text, now);
    if (!tz) {
      await ctx.reply(t.timezoneNotUnderstood, { reply_markup: timezoneBackKeyboard() });
      return;
    }
    await updateSettings(ctx.db, ctx.user.id, { timezone: tz });
    await ctx.reply(t.timezoneCustomSet(formatUtcOffset(now, tz), formatLocalTime(now, tz)));
    await setStep(ctx, 'anchors');
    await sendStepPrompt(ctx);
    return;
  }

  await ctx.reply(t.finishSetupFirst);
  await sendStepPrompt(ctx);
});
