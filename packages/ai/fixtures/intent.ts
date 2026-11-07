import type { ActiveMedSummary, IntentResult } from '../src/index.ts';

export interface IntentFixture {
  id: string;
  input: string;
  expected: Partial<Omit<IntentResult, 'params'>> & { params?: Partial<IntentResult['params']> };
}

export const intentMeds: ActiveMedSummary[] = [
  { id: 11, name: 'Магний', schedule: 'каждый день после завтрака, 1 таблетка' },
  { id: 12, name: 'Витамин D3', schedule: 'каждый день утром, 1 капсула' },
  { id: 13, name: 'Омега-3', schedule: 'каждый день после ужина, 1 капсула' },
];

export const intentToday = '2026-11-07';

/** Only the listed fields are compared by eval. */
export const intentFixtures: IntentFixture[] = [
  { id: 'mark-taken', input: 'выпила магний', expected: { intent: 'mark_taken', targets: [11] } },
  {
    id: 'mark-taken-unknown',
    input: 'выпила ибупрофен',
    expected: { intent: 'mark_taken', targets: [] },
  },
  {
    id: 'change-time',
    input: 'магний теперь после ужина',
    expected: {
      intent: 'change_time',
      targets: [11],
      params: { slots: [{ time: null, anchor: 'dinner', anchorOffsetMin: null }] },
    },
  },
  {
    id: 'change-time-exact',
    input: 'перенеси витамин д на 10:00',
    expected: {
      intent: 'change_time',
      targets: [12],
      params: { slots: [{ time: '10:00', anchor: null, anchorOffsetMin: null }] },
    },
  },
  {
    id: 'change-amount',
    input: 'теперь витамин D по 2 капсулы',
    expected: { intent: 'change_amount', targets: [12], params: { unitsPerIntake: 2 } },
  },
  {
    id: 'pause-week',
    input: 'поставь омегу на паузу на неделю',
    expected: { intent: 'pause', targets: [13], params: { pauseDays: 7 } },
  },
  {
    id: 'complete',
    input: 'я закончила курс магния',
    expected: { intent: 'complete', targets: [11] },
  },
  { id: 'delete', input: 'удали витамин D совсем', expected: { intent: 'delete', targets: [12] } },
  { id: 'add', input: 'добавь железо по 1 таблетке через день', expected: { intent: 'add' } },
  {
    id: 'medical-question',
    input: 'а можно магний пить вместе с кофе?',
    expected: { intent: 'other', otherKind: 'medical' },
  },
  { id: 'chat', input: 'спасибо, Ови!', expected: { intent: 'other', otherKind: 'chat' } },
];
