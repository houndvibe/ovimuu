import { InlineKeyboard } from 'grammy';
import { ANCHOR_KEYS, ANCHOR_STEP_MIN, type Anchors, formatTime } from '../domain/anchors.ts';
import { formatLocalTime } from '../domain/timezone.ts';
import { texts } from '../texts.ts';

const t = texts.onboarding;

// Callback data (≤ 64 bytes). Prefix "ob:" = onboarding.
export const cb = {
  consent: 'ob:consent',
  tzPrefix: 'ob:tz:',
  tzOther: 'ob:tz:other',
  tzList: 'ob:tz:list',
  anchorsOk: 'ob:anc:ok',
  anchorsEdit: 'ob:anc:edit',
  anchorsDone: 'ob:anc:done',
  noop: 'ob:noop',
} as const;

export const anchorShiftData = (key: string, delta: number) =>
  `ob:anc:${key}:${delta > 0 ? '+' : ''}${delta}`;
export const anchorShiftPattern = /^ob:anc:(\w+):([+-]\d+)$/;

export const consentKeyboard = () => new InlineKeyboard().text(t.consentButton, cb.consent);

export function timezoneKeyboard(now: Date): InlineKeyboard {
  const kb = new InlineKeyboard();
  texts.timezonePresets.forEach(({ tz, label }, i) => {
    kb.text(t.timezoneButton(label, formatLocalTime(now, tz)), cb.tzPrefix + tz);
    if (i % 2 === 1) kb.row();
  });
  return kb.row().text(t.timezoneOtherButton, cb.tzOther);
}

export const timezoneBackKeyboard = () =>
  new InlineKeyboard().text(t.timezoneBackButton, cb.tzList);

export const anchorsKeyboard = () =>
  new InlineKeyboard()
    .text(t.anchorsOkButton, cb.anchorsOk)
    .text(t.anchorsEditButton, cb.anchorsEdit);

export function anchorsEditorKeyboard(a: Anchors): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const key of ANCHOR_KEYS) {
    kb.text('−', anchorShiftData(key, -ANCHOR_STEP_MIN))
      .text(`${texts.anchorNames[key]} ${formatTime(a[key])}`, cb.noop)
      .text('+', anchorShiftData(key, ANCHOR_STEP_MIN))
      .row();
  }
  return kb.text(t.anchorsDoneButton, cb.anchorsDone);
}
