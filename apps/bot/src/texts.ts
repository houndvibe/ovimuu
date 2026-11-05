// All user-facing bot texts live here (Russian).
import type { AnchorKey, Anchors } from './domain/anchors.ts';
import { formatTime } from './domain/anchors.ts';

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
  addFlowStub: 'Скоро научусь разбирать назначения — уже почти готово 🌱',
} as const;
