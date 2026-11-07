// Russian pluralization for amounts shown to the user. Pure functions.

/** Picks one/few/many form for an integer; fractions use the "few" form (0,5 таблетки). */
export function pluralRu(n: number, one: string, few: string, many: string): string {
  if (!Number.isInteger(n)) return few;
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

/** 2 → "2", 0.5 → "0,5". */
export function formatNumber(n: number): string {
  return Number.isInteger(n) ? String(n) : String(n).replace('.', ',');
}

const UNIT_FORMS: Record<string, [string, string, string]> = {
  таблетка: ['таблетка', 'таблетки', 'таблеток'],
  капсула: ['капсула', 'капсулы', 'капсул'],
  капля: ['капля', 'капли', 'капель'],
  капли: ['капля', 'капли', 'капель'],
  пакетик: ['пакетик', 'пакетика', 'пакетиков'],
  ложка: ['ложка', 'ложки', 'ложек'],
  пастилка: ['пастилка', 'пастилки', 'пастилок'],
  ампула: ['ампула', 'ампулы', 'ампул'],
  доза: ['доза', 'дозы', 'доз'],
};

/** "1 таблетка", "2 капсулы", "10 капель", "0,5 таблетки"; unknown form → "2 саше", none → "2 шт." */
export function formatUnits(n: number, unitForm: string | null): string {
  const num = formatNumber(n);
  if (!unitForm) return `${num} шт.`;
  const forms = UNIT_FORMS[unitForm.trim().toLowerCase()];
  return forms ? `${num} ${pluralRu(n, ...forms)}` : `${num} ${unitForm}`;
}

/** "1 день", "3 дня", "30 дней". */
export const formatDays = (n: number) => `${n} ${pluralRu(n, 'день', 'дня', 'дней')}`;
