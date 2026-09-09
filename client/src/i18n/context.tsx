import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  createTranslator,
  loadPreference,
  resolveLocale,
  savePreference,
  type Locale,
  type LocalePreference,
  type Translator,
} from "./index";

type I18nContextValue = {
  locale: Locale;
  preference: LocalePreference;
  setPreference: (pref: LocalePreference) => void;
  t: Translator;
};

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPref] = useState<LocalePreference>(() => loadPreference());
  const locale = resolveLocale(preference);

  const setPreference = useCallback((next: LocalePreference) => {
    savePreference(next);
    setPref(next);
  }, []);

  const t = useMemo(() => createTranslator(locale), [locale]);

  useEffect(() => {
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(
    () => ({ locale, preference, setPreference, t }),
    [locale, preference, setPreference, t]
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n precisa estar dentro de <I18nProvider>");
  return ctx;
}

/** Atalho para componentes que só precisam de `t`. */
export function useT(): Translator {
  return useI18n().t;
}
