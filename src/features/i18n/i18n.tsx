import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { LANGS, STRINGS, type Dict, type Lang, type StringKey } from './strings';
import { storage } from '../../utils/storage';

const LANG_KEY = 'proklinatel.lang';

interface I18n {
  lang: Lang;
  setLang: (l: Lang) => void;
  /** Current dictionary: t.startButton, t.nameLabel, ... */
  t: Dict;
  tr: (key: StringKey) => string;
}

const Ctx = createContext<I18n | null>(null);

function initialLang(): Lang {
  const saved = storage.get(LANG_KEY);
  if (saved && (LANGS as readonly string[]).includes(saved)) return saved as Lang;
  return 'en'; // English is the default by spec; the choice is remembered once made.
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(initialLang);

  const setLang = useCallback((l: Lang) => {
    setLangState(l);
    storage.set(LANG_KEY, l);
  }, []);

  useEffect(() => {
    document.documentElement.lang = lang;
    document.title = STRINGS[lang].siteTitle;
  }, [lang]);

  const value = useMemo<I18n>(() => {
    const dict = STRINGS[lang];
    return { lang, setLang, t: dict, tr: (k) => dict[k] };
  }, [lang, setLang]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useI18n(): I18n {
  const v = useContext(Ctx);
  if (!v) throw new Error('useI18n outside I18nProvider');
  return v;
}
