// i18n leve, sem dependência externa. Detecta o idioma pelo locale do
// aparelho (Austrália → en, Brasil → pt-BR, Espanha → es-ES) com fallback en-US;
// o jogador pode fixar um idioma nas configurações ("Automático" volta a detectar).
import { ptBR } from "./locales/pt-BR";
import { enUS } from "./locales/en-US";
import { esES } from "./locales/es-ES";

export type Locale = "pt-BR" | "en-US" | "es-ES";
export type LocalePreference = "auto" | Locale;

export const SUPPORTED_LOCALES: Locale[] = ["pt-BR", "en-US", "es-ES"];
export const DEFAULT_LOCALE: Locale = "en-US";

const STORAGE_KEY = "neon-blockfall-locale";

export type TranslationKey = keyof typeof ptBR;
export type Dictionary = Record<TranslationKey, string>;

const DICTIONARIES: Record<Locale, Dictionary> = {
  "pt-BR": ptBR,
  "en-US": enUS,
  "es-ES": esES,
};

/** Mapeia qualquer tag BCP-47 do navegador para um dos idiomas suportados. */
export function detectLocale(): Locale {
  const nav = typeof navigator !== "undefined" ? navigator : undefined;
  const tags = nav?.languages && nav.languages.length ? [...nav.languages] : nav?.language ? [nav.language] : [];
  for (const raw of tags) {
    const tag = raw.toLowerCase();
    if (tag.startsWith("pt")) return "pt-BR";
    if (tag.startsWith("es")) return "es-ES";
    if (tag.startsWith("en")) return "en-US";
  }
  return DEFAULT_LOCALE;
}

export function loadPreference(): LocalePreference {
  try {
    const v = window.localStorage.getItem(STORAGE_KEY);
    if (v === "pt-BR" || v === "en-US" || v === "es-ES" || v === "auto") return v;
  } catch {
    /* storage indisponível */
  }
  return "auto";
}

export function savePreference(pref: LocalePreference) {
  try {
    window.localStorage.setItem(STORAGE_KEY, pref);
  } catch {
    /* storage indisponível */
  }
}

export function resolveLocale(pref: LocalePreference): Locale {
  return pref === "auto" ? detectLocale() : pref;
}

/**
 * Cria a função `t` para um locale, com fallback para en-US e depois para a
 * própria chave. Aceita `string` para permitir chaves montadas dinamicamente
 * (`modifier.${id}.label`); as 3 traduções continuam batendo pelas mesmas chaves
 * via o tipo `Dictionary`.
 */
export function createTranslator(locale: Locale) {
  const primary = DICTIONARIES[locale] as Record<string, string>;
  const fallback = DICTIONARIES[DEFAULT_LOCALE] as Record<string, string>;
  return function t(key: TranslationKey | (string & {}), params?: Record<string, string | number>): string {
    const template = primary[key] ?? fallback[key] ?? key;
    if (!params) return template;
    return template.replace(/\{(\w+)\}/g, (_, name: string) =>
      name in params ? String(params[name]) : `{${name}}`
    );
  };
}

export type Translator = ReturnType<typeof createTranslator>;
