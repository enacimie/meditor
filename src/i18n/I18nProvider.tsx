import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  type ReactNode,
} from "react";
import {
  type Language,
  type TranslationFn,
  type TranslationKey,
  translations,
  isRtl,
} from "./translations";
import { loadLanguage, saveLanguage } from "./languageStorage";

type I18nContextValue = {
  lang: Language;
  setLanguage: (lang: Language) => void;
  t: TranslationFn;
};

function makeTranslationFn(lang: Language): TranslationFn {
  return (key, ...args) => {
    const langDict = translations[lang] as Record<string, unknown>;
    const enDict = translations.en as Record<string, unknown>;
    const value = langDict[key] ?? enDict[key];
    if (typeof value === "function") {
      return (value as (...a: unknown[]) => string)(...args);
    }
    return (value as string) ?? key;
  };
}

const I18nContext = createContext<I18nContextValue>({
  lang: "en",
  setLanguage: () => {},
  t: makeTranslationFn("en"),
});

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLang] = useState<Language>(loadLanguage);

  const setLanguage = useCallback((newLang: Language) => {
    setLang(newLang);
    saveLanguage(newLang);
    // Update html lang + dir attributes for accessibility
    document.documentElement.lang = newLang;
    document.documentElement.dir = isRtl(newLang) ? "rtl" : "ltr";
  }, []);

  // Initialize html lang + dir on mount
  useEffect(() => {
    document.documentElement.lang = lang;
    document.documentElement.dir = isRtl(lang) ? "rtl" : "ltr";
  }, [lang]);

  // Stable identity: only recreated when the language changes. Consumers can
  // safely put `t` in useEffect deps without re-running effects on every render.
  const t = useCallback(
    (key: TranslationKey, ...args: unknown[]) => {
      const langDict = translations[lang] as Record<string, unknown>;
      const enDict = translations.en as Record<string, unknown>;
      const value = langDict[key] ?? enDict[key];
      if (typeof value === "function") {
        return (value as (...a: unknown[]) => string)(...args);
      }
      return (value as string) ?? key;
    },
    [lang],
  );

  return (
    <I18nContext.Provider value={{ lang, setLanguage, t }}>
      {children}
    </I18nContext.Provider>
  );
}

export function useTranslation(): I18nContextValue {
  return useContext(I18nContext);
}
