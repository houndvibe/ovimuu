import type { BotContext } from './context.ts';

/** Downloads a Telegram file into memory. Nothing is written to disk. */
export async function downloadFile(ctx: BotContext, fileId: string): Promise<Buffer> {
  const file = await ctx.api.getFile(fileId);
  if (!file.file_path) throw new Error('Telegram returned no file_path');
  const res = await fetch(`https://api.telegram.org/file/bot${ctx.api.token}/${file.file_path}`);
  if (!res.ok) throw new Error(`Telegram file download failed with status ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}
