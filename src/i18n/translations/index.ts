import { en } from "./en";
import { es } from "./es";
import { fr } from "./fr";
import { zh } from "./zh";
import { hi } from "./hi";
import { ar } from "./ar";
import { bn } from "./bn";
import { pt } from "./pt";
import { ru } from "./ru";
import { ur } from "./ur";
import { id } from "./id";
import { de } from "./de";
import { ja } from "./ja";
import { sw } from "./sw";
import { mr } from "./mr";
import { te } from "./te";
import { tr } from "./tr";
import { ta } from "./ta";
import { ko } from "./ko";
import { it } from "./it";

/** All supported language codes. */
export type Language =
  | "en" | "zh" | "hi" | "es" | "ar"
  | "fr" | "bn" | "pt" | "ru" | "ur"
  | "id" | "de" | "ja" | "sw" | "mr"
  | "te" | "tr" | "ta" | "ko" | "it";

/** Language metadata shown in the language selector (no country flags). */
export const LANGUAGES: { code: Language; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English",    nativeLabel: "English" },
  { code: "zh", label: "Chinese",    nativeLabel: "中文" },
  { code: "hi", label: "Hindi",      nativeLabel: "हिन्दी" },
  { code: "es", label: "Spanish",    nativeLabel: "Español" },
  { code: "ar", label: "Arabic",     nativeLabel: "العربية" },
  { code: "fr", label: "French",     nativeLabel: "Français" },
  { code: "bn", label: "Bengali",    nativeLabel: "বাংলা" },
  { code: "pt", label: "Portuguese", nativeLabel: "Português" },
  { code: "ru", label: "Russian",    nativeLabel: "Русский" },
  { code: "ur", label: "Urdu",       nativeLabel: "اردو" },
  { code: "id", label: "Indonesian", nativeLabel: "Bahasa Indonesia" },
  { code: "de", label: "German",     nativeLabel: "Deutsch" },
  { code: "ja", label: "Japanese",   nativeLabel: "日本語" },
  { code: "sw", label: "Swahili",    nativeLabel: "Kiswahili" },
  { code: "mr", label: "Marathi",    nativeLabel: "मराठी" },
  { code: "te", label: "Telugu",     nativeLabel: "తెలుగు" },
  { code: "tr", label: "Turkish",    nativeLabel: "Türkçe" },
  { code: "ta", label: "Tamil",      nativeLabel: "தமிழ்" },
  { code: "ko", label: "Korean",     nativeLabel: "한국어" },
  { code: "it", label: "Italian",    nativeLabel: "Italiano" },
];

export type TranslationKey = keyof typeof en;

export type TranslationFn = (key: TranslationKey, ...args: unknown[]) => string;

/** Languages that read right-to-left (used for the `dir` attribute). */
const RTL_LANGS = new Set<string>(["ar", "ur"]);

/** Whether the language needs `dir="rtl"` on the document root. */
export function isRtl(lang: Language): boolean {
  return RTL_LANGS.has(lang);
}

export const translations = {
  en, zh, hi, es, ar, fr, bn, pt, ru, ur,
  id, de, ja, sw, mr, te, tr, ta, ko, it,
} as const;
