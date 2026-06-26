export type Locale = 'no' | 'en';

export const LOCALES: Locale[] = ['no', 'en'];

export const LOCALE_LABEL: Record<Locale, string> = {
  no: 'Norsk',
  en: 'English',
};

export function createT(translations: Record<string, unknown>) {
  return function t(key: string, vars?: Record<string, string | number>): string {
    const parts = key.split('.');
    let val: unknown = translations;
    for (const p of parts) {
      if (val == null || typeof val !== 'object') return key;
      val = (val as Record<string, unknown>)[p];
    }
    if (typeof val !== 'string') return key;
    if (!vars) return val;
    return val.replace(/\{\{(\w+)\}\}/g, (_, k) => String(vars[k] ?? `{{${k}}}`));
  };
}
