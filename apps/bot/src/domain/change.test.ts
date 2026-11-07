import { describe, expect, it } from 'vitest';
import {
  applyChange,
  type ChangeParams,
  type MedState,
  missingParam,
  nextWeekday,
  paramsFromIntent,
  pickIntakeToMark,
  resolvePauseUntil,
  toDraftMed,
} from './change.ts';

const today = '2026-11-07'; // Saturday

const state: MedState = {
  medicationId: 1,
  scheduleId: 2,
  name: 'Магний',
  doseAmount: null,
  doseUnit: null,
  unitsPerIntake: 1,
  unitForm: 'таблетка',
  notes: null,
  frequencyType: 'daily',
  everyNDays: null,
  weekdays: null,
  startDate: '2026-11-01',
  endDate: null,
  status: 'active',
  pausedUntil: null,
  slots: [
    { time: null, anchor: 'breakfast', anchorOffsetMin: 0 },
    { time: '21:00:00', anchor: null, anchorOffsetMin: 0 },
  ],
};

const noParams: ChangeParams = {
  slots: null,
  unitsPerIntake: null,
  pauseUntil: null,
  pauseIndefinite: false,
};

describe('pause dates', () => {
  it('finds the next weekday strictly after today', () => {
    expect(nextWeekday(today, 1)).toBe('2026-11-09'); // Monday
    expect(nextWeekday(today, 6)).toBe('2026-11-14'); // next Saturday, not today
  });

  it('resolves explicit date, weekday or duration', () => {
    const p = { pauseUntil: null, pauseUntilWeekday: null, pauseDays: null };
    expect(resolvePauseUntil({ ...p, pauseUntil: '2026-11-15' }, today)).toBe('2026-11-15');
    expect(resolvePauseUntil({ ...p, pauseUntilWeekday: 1 }, today)).toBe('2026-11-09');
    expect(resolvePauseUntil({ ...p, pauseDays: 7 }, today)).toBe('2026-11-14');
    expect(resolvePauseUntil(p, today)).toBeNull();
  });

  it('rejects dates that are not in the future', () => {
    const p = { pauseUntilWeekday: null, pauseDays: null };
    expect(resolvePauseUntil({ ...p, pauseUntil: today }, today)).toBeNull();
    expect(resolvePauseUntil({ ...p, pauseUntil: '2026-11-01' }, today)).toBeNull();
  });
});

describe('paramsFromIntent / missingParam', () => {
  it('drops empty slots and non-positive amounts', () => {
    const p = paramsFromIntent(
      {
        intent: 'change_time',
        targets: [1],
        params: {
          slots: [{ time: null, anchor: null, anchorOffsetMin: null }],
          unitsPerIntake: 0,
          pauseUntil: null,
          pauseUntilWeekday: null,
          pauseDays: null,
        },
        otherKind: null,
      },
      today,
    );
    expect(p).toEqual(noParams);
  });

  it('asks only for what the intent needs', () => {
    expect(missingParam('change_time', noParams)).toBe('slot');
    expect(missingParam('change_amount', noParams)).toBe('units');
    expect(missingParam('pause', noParams)).toBe('pause');
    expect(missingParam('pause', { ...noParams, pauseIndefinite: true })).toBeNull();
    expect(missingParam('resume', noParams)).toBeNull();
    expect(missingParam('delete', noParams)).toBeNull();
  });
});

describe('applyChange', () => {
  it('replaces all slots on a time change', () => {
    const after = applyChange(state, 'change_time', {
      ...noParams,
      slots: [{ time: null, anchor: 'dinner', anchorOffsetMin: null }],
    });
    expect(after.slots).toEqual([{ time: null, anchor: 'dinner', anchorOffsetMin: 0 }]);
  });

  it('changes amount, pause and resume', () => {
    expect(
      applyChange(state, 'change_amount', { ...noParams, unitsPerIntake: 2 }).unitsPerIntake,
    ).toBe(2);
    expect(applyChange(state, 'pause', { ...noParams, pauseUntil: '2026-11-15' })).toMatchObject({
      status: 'paused',
      pausedUntil: '2026-11-15',
    });
    expect(
      applyChange(state, 'pause', { ...noParams, pauseIndefinite: true }).pausedUntil,
    ).toBeNull();
    expect(
      applyChange({ ...state, status: 'paused', pausedUntil: '2026-11-15' }, 'resume', noParams),
    ).toMatchObject({ status: 'active', pausedUntil: null });
    expect(applyChange(state, 'complete', noParams).status).toBe('completed');
  });
});

describe('toDraftMed', () => {
  it('maps DB times and offsets to the draft shape', () => {
    expect(toDraftMed(state).slots).toEqual([
      { time: null, anchor: 'breakfast', anchorOffsetMin: null },
      { time: '21:00', anchor: null, anchorOffsetMin: null },
    ]);
  });
});

describe('pickIntakeToMark', () => {
  const now = new Date('2026-11-07T08:40:00Z');
  it('picks the intake closest to now, early or late', () => {
    const c = [
      { id: 1, scheduledAt: new Date('2026-11-07T06:00:00Z') },
      { id: 2, scheduledAt: new Date('2026-11-07T09:00:00Z') },
      { id: 3, scheduledAt: new Date('2026-11-07T18:00:00Z') },
    ];
    expect(pickIntakeToMark(c, now)).toBe(2);
    expect(pickIntakeToMark([], now)).toBeNull();
  });
});
