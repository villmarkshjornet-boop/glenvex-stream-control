'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { createT, type Locale } from '@/lib/i18n';
import no from '@/locales/no.json';
import en from '@/locales/en.json';

const TRANSLATIONS: Record<Locale, Record<string, unknown>> = {
  no: no as Record<string, unknown>,
  en: en as Record<string, unknown>,
};

interface I18nContextType {
  locale: Locale;
  t: (key: string, vars?: Record<string, string | number>) => string;
  setLocale: (locale: Locale) => void;
}

const I18nContext = createContext<I18nContextType>({
  locale: 'no',
  t: (key) => key,
  setLocale: () => undefined,
});

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>('no');

  useEffect(() => {
    fetch('/api/workspace/locale')
      .then(r => r.ok ? r.json() : null)
      .then((d: { locale?: string } | null) => {
        if (d?.locale === 'no' || d?.locale === 'en') {
          setLocaleState(d.locale);
          document.documentElement.lang = d.locale;
        }
      })
      .catch(() => {});
  }, []);

  const setLocale = useCallback(async (next: Locale) => {
    setLocaleState(next);
    document.documentElement.lang = next;
    try {
      await fetch('/api/workspace/locale', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ locale: next }),
      });
    } catch {}
  }, []);

  const t = useMemo(() => createT(TRANSLATIONS[locale]), [locale]);

  return (
    <I18nContext.Provider value={{ locale, t, setLocale }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useI18n() {
  return useContext(I18nContext);
}
