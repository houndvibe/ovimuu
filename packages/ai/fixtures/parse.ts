import type { ParsedMedication, ParseResult, UserContext } from '../src/index.ts';

export interface ParseFixture {
  id: string;
  input: string;
  ctx?: Partial<UserContext>;
  expected: ParseResult;
  /** Fields compared by eval; default: all except notes. */
  compare?: (keyof ParsedMedication)[];
}

const TODAY = '2026-11-07';
export const fixtureToday = TODAY;

/** Fills unspecified fields with null so fixtures stay short. */
export function med(fields: Partial<ParsedMedication>): ParsedMedication {
  return {
    name: null,
    doseAmount: null,
    doseUnit: null,
    unitsPerIntake: null,
    unitForm: null,
    frequencyType: null,
    everyNDays: null,
    weekdays: null,
    timesPerDay: null,
    slots: [],
    mealRelation: null,
    mealOffsetMin: null,
    durationDays: null,
    startDate: null,
    endDate: null,
    notes: null,
    unsupportedReason: null,
    ...fields,
  };
}

const omega = med({
  name: 'Омега-3',
  unitsPerIntake: 1,
  unitForm: 'капсула',
  frequencyType: 'daily',
  timesPerDay: 1,
  slots: [{ time: null, anchor: 'breakfast', anchorOffsetMin: null }],
});

export const parseFixtures: ParseFixture[] = [
  {
    id: 'ocr-clinic-header',
    input:
      'ГБУЗ Поликлиника №3\nПациент: Иванова А.А., 34 года\nДиагноз: дефицит магния\nРекомендации:\n' +
      '1. Магне В6 по 1 таб. 2 раза в день после еды, 30 дней\n' +
      '2. Витамин D3 2000 ME 1 капсула утром ежедневно\nВрач: Петров И.И.',
    expected: {
      medications: [
        med({
          name: 'Магне B6',
          unitsPerIntake: 1,
          unitForm: 'таблетка',
          frequencyType: 'daily',
          timesPerDay: 2,
          mealRelation: 'after',
          durationDays: 30,
        }),
        med({
          name: 'Витамин D3',
          doseAmount: 2000,
          doseUnit: 'МЕ',
          unitsPerIntake: 1,
          unitForm: 'капсула',
          frequencyType: 'daily',
          timesPerDay: 1,
          slots: [{ time: null, anchor: 'wake', anchorOffsetMin: null }],
        }),
      ],
    },
  },
  {
    id: 'voice-omega',
    input: 'Добавь омегу 3 по 1 капсуле каждый день после завтрака',
    expected: { medications: [omega] },
  },
  {
    id: 'every-other-day',
    input: 'Сорбифер 1 таблетка через день перед сном',
    expected: {
      medications: [
        med({
          name: 'Сорбифер',
          unitsPerIntake: 1,
          unitForm: 'таблетка',
          frequencyType: 'every_n_days',
          everyNDays: 2,
          timesPerDay: 1,
          slots: [{ time: null, anchor: 'sleep', anchorOffsetMin: null }],
        }),
      ],
    },
  },
  {
    id: 'weekdays-exact-time',
    input: 'Витамин B12 1000 мкг, 1 таблетка по понедельникам и четвергам в 9:00',
    expected: {
      medications: [
        med({
          name: 'Витамин B12',
          doseAmount: 1000,
          doseUnit: 'мкг',
          unitsPerIntake: 1,
          unitForm: 'таблетка',
          frequencyType: 'weekdays',
          weekdays: [1, 4],
          timesPerDay: 1,
          slots: [{ time: '09:00', anchor: null, anchorOffsetMin: null }],
        }),
      ],
    },
  },
  {
    id: 'anchor-offset',
    input: 'Эутирокс 50 мкг по 1 таблетке ежедневно за 30 минут до завтрака',
    expected: {
      medications: [
        med({
          name: 'Эутирокс',
          doseAmount: 50,
          doseUnit: 'мкг',
          unitsPerIntake: 1,
          unitForm: 'таблетка',
          frequencyType: 'daily',
          timesPerDay: 1,
          slots: [{ time: null, anchor: 'breakfast', anchorOffsetMin: -30 }],
        }),
      ],
    },
  },
  {
    id: 'drops-course-weeks',
    input: 'Аквадетрим 2 капли раз в день, курс 2 недели',
    expected: {
      medications: [
        med({
          name: 'Аквадетрим',
          unitsPerIntake: 2,
          unitForm: 'капли',
          frequencyType: 'daily',
          timesPerDay: 1,
          durationDays: 14,
        }),
      ],
    },
  },
  {
    id: 'name-only',
    input: 'магний',
    expected: { medications: [med({ name: 'Магний' })] },
  },
  {
    id: 'evening-is-ambiguous',
    input: 'Мелатонин 3 мг вечером',
    expected: { medications: [med({ name: 'Мелатонин', doseAmount: 3, doseUnit: 'мг' })] },
  },
  {
    id: 'stepped-dose',
    input: 'Преднизолон: 3 дня по 2 таблетки, потом 3 дня по 1 таблетке',
    expected: { medications: [med({ name: 'Преднизолон', unsupportedReason: 'stepped_dose' })] },
    compare: ['name', 'unsupportedReason'],
  },
  {
    id: 'as-needed',
    input: 'Нурофен 200 мг при головной боли',
    expected: { medications: [med({ name: 'Нурофен', unsupportedReason: 'as_needed' })] },
    compare: ['name', 'unsupportedReason'],
  },
  {
    id: 'no-medications',
    input: 'Пациентка жалуется на усталость. Рекомендовано: больше гулять, пить воду, сдать ОАК.',
    expected: { medications: [] },
  },
  {
    id: 'correction-with-draft',
    input: 'не после завтрака, а после ужина',
    ctx: { currentDraft: { medications: [omega] } },
    expected: {
      medications: [{ ...omega, slots: [{ time: null, anchor: 'dinner', anchorOffsetMin: null }] }],
    },
  },
];
