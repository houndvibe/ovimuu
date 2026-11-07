// All user-facing bot texts live here (Russian).
import type { AiErrorCode, ParsedSlot, UnsupportedReason } from '@ovimuu/ai';
import type { AnchorKey, Anchors } from './domain/anchors.ts';
import { formatTime, parseTime, shiftTime } from './domain/anchors.ts';
import { formatDateRu } from './domain/dates.ts';
import { type DraftMed, type MealPreset, scheduleDates } from './domain/draft.ts';
import { formatDays, formatNumber, formatUnits, pluralRu } from './domain/plural.ts';

const anchorNames: Record<AnchorKey, string> = {
  wake: 'Подъём',
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  sleep: 'Сон',
};

/** Preset time zones shown as buttons, in display order (west → east). */
const timezonePresets: ReadonlyArray<{ tz: string; label: string }> = [
  { tz: 'Europe/Kaliningrad', label: 'Калининград' },
  { tz: 'Europe/Moscow', label: 'Москва' },
  { tz: 'Europe/Samara', label: 'Самара' },
  { tz: 'Asia/Yekaterinburg', label: 'Екатеринбург' },
  { tz: 'Asia/Omsk', label: 'Омск' },
  { tz: 'Asia/Novosibirsk', label: 'Новосибирск' },
  { tz: 'Asia/Irkutsk', label: 'Иркутск' },
  { tz: 'Asia/Vladivostok', label: 'Владивосток' },
];

const anchorsList = (a: Anchors) =>
  `подъём ${formatTime(a.wake)}, завтрак ${formatTime(a.breakfast)}, ` +
  `обед ${formatTime(a.lunch)}, ужин ${formatTime(a.dinner)}, сон ${formatTime(a.sleep)}`;

export const texts = {
  anchorNames,
  timezonePresets,

  onboarding: {
    greeting: 'Привет! Я Ови 🌿\nПомогу не забывать про лекарства и витамины — без лишней суеты.',
    consent:
      'Чтобы распознавать фото и голосовые, я отправляю их в Yandex Cloud. ' +
      'Фото не сохраняю — только итоговое расписание. ' +
      'Удалить всё можно в любой момент: /delete',
    consentButton: 'Понятно',
    consentAccepted: '✅ Понятно',

    timezonePrompt: 'В каком ты часовом поясе? Рядом — сколько там сейчас времени.',
    timezoneButton: (label: string, localTime: string) => `${label} · ${localTime}`,
    timezoneOtherButton: 'Другой',
    timezoneChosen: (label: string) => `✅ ${label}`,
    timezoneOtherChosen: '✅ Другой',
    timezoneCustomPrompt:
      'Напиши, сколько у тебя сейчас времени, например 14:35 — я сам вычислю пояс.\n' +
      'Можно и смещением: UTC+5 или МСК+2.',
    timezoneBackButton: '← Выбрать из списка',
    timezoneNotUnderstood:
      'Не получилось понять 🙈 Напиши текущее время, например 14:35, или смещение: UTC+5, МСК+2.',
    timezoneCustomSet: (offset: string, localTime: string) =>
      `Запомнил: ${offset}, у тебя сейчас ${localTime}.`,

    anchorsPrompt: (a: Anchors) =>
      `Обычно я считаю так: ${anchorsList(a)}.\n` +
      'По этим точкам удобно ставить напоминания «после завтрака» или «перед сном».',
    anchorsOkButton: 'Подходит',
    anchorsEditButton: 'Настроить',
    anchorsOkChosen: '✅ Подходит',
    anchorsEditPrompt: 'Подвинь время кнопками − и + (шаг 30 минут), потом нажми «Готово».',
    anchorsDoneButton: 'Готово',
    anchorsSaved: (a: Anchors) => `✅ Сохранил: ${anchorsList(a)}.`,
    anchorsOrderError: (before: AnchorKey, after: AnchorKey) =>
      after === 'sleep'
        ? 'Сон должен быть позже ужина 🌙'
        : `${anchorNames[after]} должен быть позже, чем ${anchorNames[before].toLowerCase()}.`,

    done: 'Готово! Теперь расскажи, что ты принимаешь: голосом, фото или текстом 🌿',
    finishSetupFirst: 'Давай сначала закончим настройку — это займёт минутку 🌿',
    staleButton: 'Это уже выбрано 🙂',
  },

  welcomeBack: 'С возвращением! 🌿 Я рядом.',

  add: {
    nothingFound:
      'Не нашёл здесь назначений 🙈 Напиши, например: «Магний по 1 таблетке после ужина» — или пришли фото рецепта.',
    unsupportedInput: 'Пришли текст, голосовое или фото назначения 🌿',
    unsupported: (name: string | null, reason: UnsupportedReason) => {
      const n = name ?? 'Один из препаратов';
      switch (reason) {
        case 'stepped_dose':
          return `${n}: схему с меняющейся дозой я пока не умею 🙈 Можно добавить каждую ступень отдельно — например: «${name ?? 'Препарат'} по 2 таблетки 3 дня».`;
        case 'as_needed':
          return `${n}: приём «по необходимости» я не напоминаю — только по расписанию.`;
        case 'cycle':
          return `${n}: циклы с перерывами я пока не умею. Можно добавить один курс с датой окончания, а следующий — потом.`;
        case 'other':
          return `${n}: такую схему я пока не умею 🙈 Попробуй описать попроще или разбить на части.`;
      }
    },
    aiError: (code: AiErrorCode, source: 'text' | 'voice' | 'photo') => {
      switch (code) {
        case 'audio_too_long':
        case 'audio_too_large':
          return 'Голосовое длинновато 🙈 Я понимаю до 30 секунд — попробуй короче или по частям.';
        case 'image_too_large':
          return 'Фото слишком большое — попробуй переснять или прислать сжатым.';
        case 'unsupported_format':
          return 'Такой формат я не понимаю — пришли фото, голосовое или текст.';
        case 'nothing_recognized':
          return source === 'photo'
            ? 'Не получилось прочитать текст на фото 🙈 Попробуй переснять ровнее и при хорошем свете.'
            : 'Не расслышал 🙈 Попробуй ещё раз или напиши текстом.';
        case 'invalid_response':
          return 'Что-то я запутался 🙈 Попробуй сформулировать иначе, например: «Магний по 1 таблетке после ужина».';
        case 'unavailable':
          return 'Не получается связаться с сервисом распознавания. Попробуй через минутку 🌿';
      }
    },

    // Clarification questions
    askName: 'Как называется препарат? Напиши название.',
    askFrequency: (name: string) => `${name}: как часто?`,
    frequencyButtons: {
      daily: 'Каждый день',
      everyOtherDay: 'Через день',
      weekdays: 'По дням недели',
      once: 'Один раз',
    },
    askWeekdays: (name: string) => `${name}: в какие дни? Отметь и нажми «Готово».`,
    weekdayShort: ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'] as const,
    weekdaysDone: 'Готово',
    weekdaysEmpty: 'Отметь хотя бы один день 🙂',
    askUnits: (name: string) => `${name}: сколько за один приём?`,
    unitsButton: (n: number, unitForm: string | null) =>
      unitForm ? formatUnits(n, unitForm) : String(n),
    otherButton: 'Другое',
    askUnitsTyped: 'Напиши количество числом, например 2 или 0,5.',
    askSlot: (name: string, index: number, total: number) =>
      total > 1
        ? `Когда принимать ${name}? (приём ${index + 1} из ${total})`
        : `Когда принимать ${name}?`,
    slotButton: (anchor: AnchorKey, a: Anchors) =>
      `${slotAnchorLabels[anchor]} · ${formatTime(a[anchor])}`,
    customTimeButton: 'Своё время',
    askTimeTyped: 'Напиши время, например 9:30 или 21:00.',
    mealPresetButton: (p: MealPreset) => describeMealPreset(p),
    notUnderstood: 'Не понял 🙈',
    chosen: (label: string) => `✅ ${label}`,

    // Confirmation
    cardHeader: 'Проверь, всё ли верно:',
    medCard: (m: DraftMed, a: Anchors, today: string) => medCard(m, a, today),
    confirmButton: 'Всё верно',
    editButton: 'Исправить',
    cancelButton: 'Отмена',
    askCorrection: 'Напиши, что поменять — например: «магний не после завтрака, а после ужина» 🙂',
    saved: 'Сохранил ✅ Напоминания подключу совсем скоро — я над этим работаю 🌱',
    cardSaved: '✅ Сохранено',
    cancelled: 'Хорошо, ничего не сохраняю 🌿',
    cardCancelled: '✖️ Отменено',
    staleButton: 'Это уже неактуально 🙂',
  },
} as const;

// ---------- Formatting helpers for medication cards ----------

const slotAnchorLabels: Record<AnchorKey, string> = {
  wake: 'Утром',
  breakfast: 'Завтрак',
  lunch: 'Обед',
  dinner: 'Ужин',
  sleep: 'Перед сном',
};

const anchorPhrase: Record<AnchorKey, string> = {
  wake: 'утром',
  breakfast: 'завтрак',
  lunch: 'обед',
  dinner: 'ужин',
  sleep: 'перед сном',
};

const anchorGenitive: Record<AnchorKey, string> = {
  wake: 'подъёма',
  breakfast: 'завтрака',
  lunch: 'обеда',
  dinner: 'ужина',
  sleep: 'сна',
};

function describeMealPreset(p: MealPreset): string {
  const meals = p.anchors.map((x) => anchorGenitive[x]);
  const list = meals.length > 1 ? `${meals.slice(0, -1).join(', ')} и ${meals.at(-1)}` : meals[0];
  if (p.offsetMin < 0) return `За ${-p.offsetMin} мин до ${list}`;
  if (p.offsetMin > 0) return `Через ${p.offsetMin} мин после ${list}`;
  return p.relation === 'during' ? `Во время ${list}` : `После ${list}`;
}

function describeSlot(s: ParsedSlot, a: Anchors): string {
  if (s.time) return `в ${formatTime(parseTime(s.time))}`;
  if (!s.anchor) return '?';
  const offset = s.anchorOffsetMin ?? 0;
  const at = formatTime(shiftTime(a[s.anchor], offset));
  if (offset > 0) return `через ${offset} мин после ${anchorGenitive[s.anchor]} (${at})`;
  if (offset < 0) return `за ${-offset} мин до ${anchorGenitive[s.anchor]} (${at})`;
  return `${anchorPhrase[s.anchor]} (${at})`;
}

const weekdayNames = ['пн', 'вт', 'ср', 'чт', 'пт', 'сб', 'вс'];

function describeFrequency(m: DraftMed): string {
  switch (m.frequencyType) {
    case 'daily':
      return 'каждый день';
    case 'every_n_days':
      return m.everyNDays === 2
        ? 'через день'
        : `раз в ${m.everyNDays} ${pluralRu(m.everyNDays ?? 0, 'день', 'дня', 'дней')}`;
    case 'weekdays':
      return (m.weekdays ?? []).map((d) => weekdayNames[d - 1]).join(', ');
    case 'once':
      return 'один раз';
    default:
      return '?';
  }
}

function medCard(m: DraftMed, a: Anchors, today: string): string {
  const dose =
    m.doseAmount !== null
      ? ` ${formatNumber(m.doseAmount)}${m.doseUnit ? ` ${m.doseUnit}` : ''}`
      : '';
  const units = m.unitsPerIntake !== null ? ` — ${formatUnits(m.unitsPerIntake, m.unitForm)}` : '';
  const lines = [`💊 ${m.name}${dose}${units}`];

  const when = m.slots.map((s) => describeSlot(s, a)).join(', ');
  lines.push(`   ${describeFrequency(m)}${when ? ` · ${when}` : ''}`);

  const { start, end } = scheduleDates(m, today);
  const startText = start === today ? 'сегодня' : formatDateRu(start, today);
  if (m.frequencyType === 'once') {
    lines.push(`   ${startText}`);
  } else {
    const parts: string[] = [];
    if (start !== today) parts.push(`с ${startText}`);
    if (m.durationDays && !m.endDate) parts.push(formatDays(m.durationDays));
    if (end) parts.push(`до ${formatDateRu(end, today)}`);
    if (parts.length) lines.push(`   ${parts.join(', ')}`);
  }
  if (m.notes) lines.push(`   📝 ${m.notes}`);
  return lines.join('\n');
}
