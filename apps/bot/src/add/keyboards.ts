import { InlineKeyboard } from 'grammy';
import { ANCHOR_KEYS, type Anchors } from '../domain/anchors.ts';
import type { Question } from '../domain/draft.ts';
import type { DraftMed } from '../domain/draft.ts';
import { texts } from '../texts.ts';

const t = texts.add;

// Callback data: "d:<draftId>:<seq>:<action>" (≤ 64 bytes). seq invalidates old buttons.
export const draftCallbackPattern = /^d:(\d+):(\d+):(.+)$/;
const data = (draftId: number, seq: number, action: string) => `d:${draftId}:${seq}:${action}`;

export function questionKeyboard(
  q: Question,
  med: DraftMed,
  anchors: Anchors,
  draftId: number,
  seq: number,
): InlineKeyboard | undefined {
  const d = (action: string) => data(draftId, seq, action);
  switch (q.kind) {
    case 'name':
      return undefined; // typed answer
    case 'frequency':
      return new InlineKeyboard()
        .text(t.frequencyButtons.daily, d('f:daily'))
        .text(t.frequencyButtons.everyOtherDay, d('f:eod'))
        .row()
        .text(t.frequencyButtons.weekdays, d('f:wd'))
        .text(t.frequencyButtons.once, d('f:once'));
    case 'weekdays': {
      const kb = new InlineKeyboard();
      t.weekdayShort.forEach((label, i) => {
        const day = i + 1;
        kb.text(q.selected.includes(day) ? `✓ ${label}` : label, d(`wd:${day}`));
      });
      return kb.row().text(t.weekdaysDone, d('wd:ok'));
    }
    case 'units':
      return new InlineKeyboard()
        .text(t.unitsButton(1, med.unitForm), d('u:1'))
        .text(t.unitsButton(2, med.unitForm), d('u:2'))
        .text(t.unitsButton(3, med.unitForm), d('u:3'))
        .row()
        .text(t.otherButton, d('u:other'));
    case 'slot': {
      const kb = new InlineKeyboard();
      if (q.mealPreset) kb.text(t.mealPresetButton(q.mealPreset), d('s:preset')).row();
      ANCHOR_KEYS.forEach((anchor, i) => {
        kb.text(t.slotButton(anchor, anchors), d(`s:${anchor}`));
        if (i % 2 === 1) kb.row();
      });
      return kb.text(t.customTimeButton, d('s:time'));
    }
  }
}

export const cardKeyboard = (draftId: number, seq: number) =>
  new InlineKeyboard()
    .text(t.confirmButton, data(draftId, seq, 'ok'))
    .row()
    .text(t.editButton, data(draftId, seq, 'edit'))
    .text(t.cancelButton, data(draftId, seq, 'cancel'))
    .row()
    .text(texts.feedback.button, data(draftId, seq, 'fb'));
