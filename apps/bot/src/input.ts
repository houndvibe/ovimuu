// Entry point for free-form input after onboarding: text, voice, photo.
import { MAX_VOICE_DURATION_SEC } from '@ovimuu/ai';
import { Composer } from 'grammy';
import { addFromPhoto, continueAddDraft } from './add/handlers.ts';
import { getOpenChangeDraft, routeFreeText, tryChangeTypedAnswer } from './change/handlers.ts';
import type { BotContext } from './context.ts';
import { type Source, userClock, withAi } from './flow.ts';
import { getOpenDraft } from './repo/drafts.ts';
import { saveChangeDraft } from './repo/meds.ts';
import { downloadFile } from './telegram-files.ts';
import { texts } from './texts.ts';

/**
 * Text (typed or transcribed):
 * 1. open add-draft → its answer or correction (no router while clarifying);
 * 2. open change-draft waiting for a typed value → that value;
 * 3. otherwise → routeIntent (an unfinished change-draft is dropped).
 */
async function handleFreeText(ctx: BotContext, text: string, source: Source): Promise<void> {
  const clock = await userClock(ctx);
  const addDraft = await getOpenDraft(ctx.db, ctx.user.id);
  if (addDraft) return continueAddDraft(ctx, addDraft, text, source, clock);

  const changeDraft = await getOpenChangeDraft(ctx.db, ctx.user.id);
  if (changeDraft) {
    if (await tryChangeTypedAnswer(ctx, changeDraft, text, clock)) return;
    await saveChangeDraft(ctx.db, changeDraft, 'cancelled');
  }
  await routeFreeText(ctx, text, source, clock);
}

export const input = new Composer<BotContext>();

input.on('message:text', async (ctx) => {
  if (ctx.message.text.startsWith('/')) {
    await ctx.reply(texts.add.unsupportedInput);
    return;
  }
  await handleFreeText(ctx, ctx.message.text, 'text');
});

input.on('message:voice', async (ctx) => {
  const voice = ctx.message.voice;
  if (voice.duration > MAX_VOICE_DURATION_SEC) {
    await ctx.reply(texts.add.aiError('audio_too_long', 'voice'));
    return;
  }
  const text = await withAi(ctx, 'voice', async () =>
    ctx.ai.transcribe(await downloadFile(ctx, voice.file_id), voice.mime_type ?? 'audio/ogg'),
  );
  if (text) await handleFreeText(ctx, text, 'voice');
});

// Photos are always prescriptions → add flow (appends to an open draft).
input.on('message:photo', (ctx) => addFromPhoto(ctx, ctx.message.photo.at(-1)!.file_id));

input.on('message', (ctx) => ctx.reply(texts.add.unsupportedInput));
