'use client';

import { createContext, useContext, useState, useEffect, ReactNode } from 'react';
import { translations, type Lang, type TKey } from './i18nData';

export type { Lang, TKey };
export { translations };


// ─── Context ──────────────────────────────────────────────────────────────────
const LanguageContext = createContext<{
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (key: TKey, vars?: Record<string, string | number>) => string;
}>({
  lang: 'en',
  setLang: () => {},
  t: (k) => (translations.en as Record<string, string>)[k],
});

export function LanguageProvider({ children }: { children: ReactNode }) {
  // English is the site's universal default/fallback. This initial state is
  // only what's used for the very first paint before the effect below runs
  // (it can't read localStorage/cookies during SSR) — keeping it 'en' avoids
  // a flash-of-French for every visitor regardless of country.
  const [lang, setLangState] = useState<Lang>('en');

  useEffect(() => {
    // 1. Respect explicit user preference stored in localStorage (picker clicks)
    const saved = localStorage.getItem('aom_lang') as Lang | null;
    if (saved && (saved === 'fr' || saved === 'en' || saved === 'es')) {
      setLangState(saved);
      return;
    }
    // 2. Read the aom_lang cookie set by the middleware from Accept-Language
    const cookieMatch = document.cookie.match(/(?:^|;\s*)aom_lang=([^;]+)/);
    if (cookieMatch) {
      const val = cookieMatch[1];
      if (val === 'fr' || val === 'en' || val === 'es') {
        setLangState(val);
        return;
      }
    }
    // 3. Final client-side fallback — navigator.language ("fr-FR", "en-US", …)
    //    If the browser language isn't one we support, default to English
    //    as the international fallback (not French).
    const browserLang = (navigator.language || '').toLowerCase().slice(0, 2);
    const detected: Lang =
      browserLang === 'fr' ? 'fr' :
      browserLang === 'es' ? 'es' :
      'en';
    setLangState(detected);
  }, []);

  const setLang = (l: Lang) => {
    setLangState(l);
    localStorage.setItem('aom_lang', l);
    // Also sync the cookie the middleware reads: server components (their
    // generateMetadata/JSON-LD/static pages) can only see the cookie, not
    // localStorage, so without this a manual language switch would keep
    // showing server-rendered content in the old language until the cookie
    // happened to expire or get overwritten some other way.
    document.cookie = `aom_lang=${l}; path=/; max-age=${60 * 60 * 24 * 365}; SameSite=Lax`;
  };

  const t = (key: TKey, vars?: Record<string, string | number>): string => {
    const dict = translations[lang] as Record<string, string>;
    let str = dict[key] ?? (translations.en as Record<string, string>)[key] ?? key;
    if (vars) {
      Object.entries(vars).forEach(([k, v]) => {
        str = str.replace(`{${k}}`, String(v));
      });
    }
    return str;
  };

  return (
    <LanguageContext.Provider value={{ lang, setLang, t }}>
      {children}
    </LanguageContext.Provider>
  );
}

export function useT() {
  return useContext(LanguageContext);
}

// ─── Language metadata ────────────────────────────────────────────────────────
export const LANGUAGES: { code: Lang; label: string; flag: string }[] = [
  { code: 'fr', label: 'Français', flag: '🇫🇷' },
  { code: 'en', label: 'English',  flag: '🇬🇧' },
  { code: 'es', label: 'Español',  flag: '🇪🇸' },
];

// Explicit Intl locale for `toLocaleDateString`/`toLocaleTimeString` calls.
// Never pass `undefined` as the locale arg to those — it resolves to the
// RUNTIME's ambient locale (OS/ICU default on the server, navigator.language
// in the browser), which differ between the prod server (en-US-ish
// container) and a non-English visitor's browser → React hydration mismatch
// (#418/#423/#425) on first paint. Tying it to `lang` keeps server and
// client in agreement (LanguageProvider's SSR-safe default is always 'en'
// on both sides until the post-mount effect runs).
export function localeFromLang(lang: Lang): string {
  return lang === 'fr' ? 'fr-FR' : lang === 'es' ? 'es-ES' : 'en-US';
}
