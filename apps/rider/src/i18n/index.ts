// i18n — tiny, dependency-light. PL / EN / EL string tables with English
// fallback, dotted-path lookup and {{var}} interpolation. Device language is
// auto-detected (expo-localization, guarded); user can override in Profile.
import { create } from 'zustand';
import { useBrand } from '../brand';
import { en, type Dict } from './en';
import { el } from './el';
import { pl } from './pl';

export type Lang = 'en' | 'el' | 'pl';
export const LANGS: Lang[] = ['en', 'el', 'pl'];
export const LANG_LABEL: Record<Lang, string> = {
  en: 'English',
  el: 'Ελληνικά',
  pl: 'Polski',
};

const tables: Record<Lang, Dict> = { en, el, pl };

function detectDeviceLang(): Lang {
  try {
    // expo-localization is optional; guard it.
    const loc = require('expo-localization') as typeof import('expo-localization');
    const codes = loc.getLocales?.() ?? [];
    for (const l of codes) {
      const code = (l.languageCode ?? '').toLowerCase();
      if (code === 'el' || code === 'pl' || code === 'en') return code as Lang;
    }
  } catch {
    /* fall through */
  }
  return 'el'; // Greece-first default
}

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useI18n = create<I18nState>((set) => ({
  lang: detectDeviceLang(),
  setLang: (lang) => set({ lang }),
}));

type Vars = Record<string, string | number>;

function lookup(dict: Dict, path: string): string | undefined {
  const parts = path.split('.');
  let cur: unknown = dict;
  for (const p of parts) {
    if (cur && typeof cur === 'object' && p in (cur as Record<string, unknown>)) {
      cur = (cur as Record<string, unknown>)[p];
    } else {
      return undefined;
    }
  }
  return typeof cur === 'string' ? cur : undefined;
}

function interpolate(tpl: string, vars?: Vars): string {
  if (!vars) return tpl;
  return tpl.replace(/\{\{(\w+)\}\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{{${k}}}`,
  );
}

/** Translate a dotted key with the given language, English fallback. */
export function translate(lang: Lang, key: string, vars?: Vars): string {
  const hit = lookup(tables[lang], key) ?? lookup(en, key) ?? key;
  return interpolate(hit, vars);
}

/**
 * Hook: returns a `t` bound to the active language (re-renders on change).
 *
 * `{{brand}}` and `{{brandEmoji}}` are injected implicitly from the active
 * brand, so product copy never hardcodes an operator name. An explicit var of
 * the same name still wins.
 */
export function useT() {
  const lang = useI18n((s) => s.lang);
  const { brand } = useBrand();
  const t = (key: string, vars?: Vars) =>
    translate(lang, key, {
      brand: brand.name,
      brandEmoji: brand.assets.emoji ?? '',
      ...(vars ?? {}),
    });
  return { t, lang };
}
