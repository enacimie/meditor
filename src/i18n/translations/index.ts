import { en } from "./en";
import { zh } from "./zh";
import { hi } from "./hi";
import { es } from "./es";
import { ar } from "./ar";
import { fr } from "./fr";
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
import { pl } from "./pl";
import { vi } from "./vi";
import { th } from "./th";
import { fa } from "./fa";
import { nl } from "./nl";
import { uk } from "./uk";
import { ro } from "./ro";
import { he } from "./he";
import { ms } from "./ms";
import { fil } from "./fil";
import { pa } from "./pa";
import { jv } from "./jv";
import { ha } from "./ha";
import { kn } from "./kn";
import { gu } from "./gu";
import { am } from "./am";
import { yo } from "./yo";
import { or } from "./or";
import { ml } from "./ml";
import { my } from "./my";
import { uz } from "./uz";
import { ig } from "./ig";
import { ne } from "./ne";
import { si } from "./si";
import { km } from "./km";
import { kk } from "./kk";
import { az } from "./az";
import { ku } from "./ku";
import { ht } from "./ht";
import { ceb } from "./ceb";
import { sv } from "./sv";
import { da } from "./da";
import { fi } from "./fi";
import { no } from "./no";
import { cs } from "./cs";
import { sk } from "./sk";
import { hu } from "./hu";
import { bg } from "./bg";
import { el } from "./el";
import { ca } from "./ca";
import { sr } from "./sr";
import { hr } from "./hr";
import { lt } from "./lt";
import { lv } from "./lv";
import { et } from "./et";
import { sl } from "./sl";
import { mk } from "./mk";
import { sq } from "./sq";
import { hy } from "./hy";
import { ka } from "./ka";
import { mn } from "./mn";
import { lo } from "./lo";
import { gl } from "./gl";
import { eu } from "./eu";
import { is } from "./is";
import { mt } from "./mt";
import { cy } from "./cy";
import { gd } from "./gd";
import { ga } from "./ga";
import { lb } from "./lb";
import { af } from "./af";
import { zu } from "./zu";
import { xh } from "./xh";
import { st } from "./st";
import { ny } from "./ny";
import { mg } from "./mg";
import { so } from "./so";
import { ps } from "./ps";
import { tk } from "./tk";
import { ky } from "./ky";
import { tg } from "./tg";
import { tt } from "./tt";
import { be } from "./be";
import { bs } from "./bs";
import { fo } from "./fo";
import { ee } from "./ee";
import { lg } from "./lg";
import { om } from "./om";
import { sd } from "./sd";
import { su } from "./su";

/** All supported language codes. */
export type Language =
  | "en" | "zh" | "hi" | "es" | "ar"
  | "fr" | "bn" | "pt" | "ru" | "ur"
  | "id" | "de" | "ja" | "sw" | "mr"
  | "te" | "tr" | "ta" | "ko" | "it"
  | "pl" | "vi" | "th" | "fa" | "nl"
  | "uk" | "ro" | "he" | "ms" | "fil"
  | "pa" | "jv" | "ha" | "kn" | "gu"
  | "am" | "yo" | "or" | "ml" | "my"
  | "uz" | "ig" | "ne" | "si" | "km"
  | "kk" | "az" | "ku" | "ht" | "ceb"
  | "sv" | "da" | "fi" | "no" | "cs"
  | "sk" | "hu" | "bg" | "el" | "ca"
  | "sr" | "hr" | "lt" | "lv" | "et"
  | "sl" | "mk" | "sq" | "hy" | "ka"
  | "mn" | "lo" | "gl" | "eu" | "is"
  | "mt" | "cy" | "gd" | "ga" | "lb"
  | "af" | "zu" | "xh" | "st" | "ny"
  | "mg" | "so" | "ps" | "tk" | "ky"
  | "tg" | "tt" | "be" | "bs" | "fo"
  | "ee" | "lg" | "om" | "sd" | "su";

/** Language metadata shown in the language selector (no country flags). */
export const LANGUAGES: { code: Language; label: string; nativeLabel: string }[] = [
  { code: "en", label: "English",         nativeLabel: "English" },
  { code: "zh", label: "Chinese",         nativeLabel: "中文" },
  { code: "hi", label: "Hindi",           nativeLabel: "हिन्दी" },
  { code: "es", label: "Spanish",         nativeLabel: "Español" },
  { code: "ar", label: "Arabic",          nativeLabel: "العربية" },
  { code: "fr", label: "French",          nativeLabel: "Français" },
  { code: "bn", label: "Bengali",         nativeLabel: "বাংলা" },
  { code: "pt", label: "Portuguese",      nativeLabel: "Português" },
  { code: "ru", label: "Russian",         nativeLabel: "Русский" },
  { code: "ur", label: "Urdu",            nativeLabel: "اردو" },
  { code: "id", label: "Indonesian",      nativeLabel: "Bahasa Indonesia" },
  { code: "de", label: "German",          nativeLabel: "Deutsch" },
  { code: "ja", label: "Japanese",        nativeLabel: "日本語" },
  { code: "sw", label: "Swahili",         nativeLabel: "Kiswahili" },
  { code: "mr", label: "Marathi",         nativeLabel: "मराठी" },
  { code: "te", label: "Telugu",          nativeLabel: "తెలుగు" },
  { code: "tr", label: "Turkish",         nativeLabel: "Türkçe" },
  { code: "ta", label: "Tamil",           nativeLabel: "தமிழ்" },
  { code: "ko", label: "Korean",          nativeLabel: "한국어" },
  { code: "it", label: "Italian",         nativeLabel: "Italiano" },
  { code: "pl", label: "Polish",          nativeLabel: "Polski" },
  { code: "vi", label: "Vietnamese",      nativeLabel: "Tiếng Việt" },
  { code: "th", label: "Thai",            nativeLabel: "ไทย" },
  { code: "fa", label: "Persian",         nativeLabel: "فارسی" },
  { code: "nl", label: "Dutch",           nativeLabel: "Nederlands" },
  { code: "uk", label: "Ukrainian",       nativeLabel: "Українська" },
  { code: "ro", label: "Romanian",        nativeLabel: "Română" },
  { code: "he", label: "Hebrew",          nativeLabel: "עברית" },
  { code: "ms", label: "Malay",           nativeLabel: "Bahasa Melayu" },
  { code: "fil", label: "Filipino",        nativeLabel: "Filipino" },
  { code: "pa", label: "Punjabi",         nativeLabel: "ਪੰਜਾਬੀ" },
  { code: "jv", label: "Javanese",        nativeLabel: "Basa Jawa" },
  { code: "ha", label: "Hausa",           nativeLabel: "Hausa" },
  { code: "kn", label: "Kannada",         nativeLabel: "ಕನ್ನಡ" },
  { code: "gu", label: "Gujarati",        nativeLabel: "ગુજરાતી" },
  { code: "am", label: "Amharic",         nativeLabel: "አማርኛ" },
  { code: "yo", label: "Yoruba",          nativeLabel: "Yorùbá" },
  { code: "or", label: "Odia",            nativeLabel: "ଓଡ଼ିଆ" },
  { code: "ml", label: "Malayalam",       nativeLabel: "മലയാളം" },
  { code: "my", label: "Burmese",         nativeLabel: "မြန်မာ" },
  { code: "uz", label: "Uzbek",           nativeLabel: "O'zbek" },
  { code: "ig", label: "Igbo",            nativeLabel: "Igbo" },
  { code: "ne", label: "Nepali",          nativeLabel: "नेपाली" },
  { code: "si", label: "Sinhala",         nativeLabel: "සිංහල" },
  { code: "km", label: "Khmer",           nativeLabel: "ខ្មែរ" },
  { code: "kk", label: "Kazakh",          nativeLabel: "Қазақша" },
  { code: "az", label: "Azerbaijani",     nativeLabel: "Azərbaycan" },
  { code: "ku", label: "Kurdish",         nativeLabel: "Kurdî" },
  { code: "ht", label: "Haitian Creole",  nativeLabel: "Kreyòl Ayisyen" },
  { code: "ceb", label: "Cebuano",         nativeLabel: "Cebuano" },
  { code: "sv", label: "Swedish",         nativeLabel: "Svenska" },
  { code: "da", label: "Danish",          nativeLabel: "Dansk" },
  { code: "fi", label: "Finnish",         nativeLabel: "Suomi" },
  { code: "no", label: "Norwegian",       nativeLabel: "Norsk" },
  { code: "cs", label: "Czech",           nativeLabel: "Čeština" },
  { code: "sk", label: "Slovak",          nativeLabel: "Slovenčina" },
  { code: "hu", label: "Hungarian",       nativeLabel: "Magyar" },
  { code: "bg", label: "Bulgarian",       nativeLabel: "Български" },
  { code: "el", label: "Greek",           nativeLabel: "Ελληνικά" },
  { code: "ca", label: "Catalan",         nativeLabel: "Català" },
  { code: "sr", label: "Serbian",         nativeLabel: "српски" },
  { code: "hr", label: "Croatian",        nativeLabel: "Hrvatski" },
  { code: "lt", label: "Lithuanian",      nativeLabel: "Lietuvių" },
  { code: "lv", label: "Latvian",         nativeLabel: "Latviešu" },
  { code: "et", label: "Estonian",        nativeLabel: "Eesti" },
  { code: "sl", label: "Slovenian",       nativeLabel: "Slovenščina" },
  { code: "mk", label: "Macedonian",      nativeLabel: "Македонски" },
  { code: "sq", label: "Albanian",        nativeLabel: "Shqip" },
  { code: "hy", label: "Armenian",        nativeLabel: "Հայերեն" },
  { code: "ka", label: "Georgian",        nativeLabel: "ქართული" },
  { code: "mn", label: "Mongolian",       nativeLabel: "Монгол" },
  { code: "lo", label: "Lao",             nativeLabel: "ລາວ" },
  { code: "gl", label: "Galician",        nativeLabel: "Galego" },
  { code: "eu", label: "Basque",          nativeLabel: "Euskara" },
  { code: "is", label: "Icelandic",       nativeLabel: "Íslenska" },
  { code: "mt", label: "Maltese",         nativeLabel: "Malti" },
  { code: "cy", label: "Welsh",           nativeLabel: "Cymraeg" },
  { code: "gd", label: "Scottish Gaelic", nativeLabel: "Gàidhlig" },
  { code: "ga", label: "Irish",           nativeLabel: "Gaeilge" },
  { code: "lb", label: "Luxembourgish",   nativeLabel: "Lëtzebuergesch" },
  { code: "af", label: "Afrikaans",       nativeLabel: "Afrikaans" },
  { code: "zu", label: "Zulu",            nativeLabel: "isiZulu" },
  { code: "xh", label: "Xhosa",           nativeLabel: "isiXhosa" },
  { code: "st", label: "Sesotho",         nativeLabel: "Sesotho" },
  { code: "ny", label: "Chichewa",        nativeLabel: "Chichewa" },
  { code: "mg", label: "Malagasy",        nativeLabel: "Malagasy" },
  { code: "so", label: "Somali",          nativeLabel: "Soomaali" },
  { code: "ps", label: "Pashto",          nativeLabel: "پښتو" },
  { code: "tk", label: "Turkmen",         nativeLabel: "Türkmen" },
  { code: "ky", label: "Kyrgyz",          nativeLabel: "Кыргызча" },
  { code: "tg", label: "Tajik",           nativeLabel: "Тоҷикӣ" },
  { code: "tt", label: "Tatar",           nativeLabel: "Татарча" },
  { code: "be", label: "Belarusian",      nativeLabel: "Беларуская" },
  { code: "bs", label: "Bosnian",         nativeLabel: "Bosanski" },
  { code: "fo", label: "Faroese",         nativeLabel: "Føroyskt" },
  { code: "ee", label: "Ewe",             nativeLabel: "Eʋegbe" },
  { code: "lg", label: "Luganda",         nativeLabel: "Luganda" },
  { code: "om", label: "Oromo",           nativeLabel: "Afaan Oromoo" },
  { code: "sd", label: "Sindhi",          nativeLabel: "سنڌي" },
  { code: "su", label: "Sundanese",       nativeLabel: "Basa Sunda" },
];

export type TranslationKey = keyof typeof en;

export type TranslationFn = (key: TranslationKey, ...args: unknown[]) => string;

/** Languages that read right-to-left (used for the `dir` attribute). */
const RTL_LANGS = new Set<string>(["ar", "ur", "fa", "he", "ps", "sd"]);

/** Whether the language needs `dir="rtl"` on the document root. */
export function isRtl(lang: Language): boolean {
  return RTL_LANGS.has(lang);
}

export const translations = {
  en, zh, hi, es, ar, fr, bn, pt, ru, ur,
  id, de, ja, sw, mr, te, tr, ta, ko, it,
  pl, vi, th, fa, nl, uk, ro, he, ms, fil,
  pa, jv, ha, kn, gu, am, yo, or, ml, my,
  uz, ig, ne, si, km, kk, az, ku, ht, ceb,
  sv, da, fi, no, cs, sk, hu, bg, el, ca,
  sr, hr, lt, lv, et, sl, mk, sq, hy, ka,
  mn, lo, gl, eu, is, mt, cy, gd, ga, lb,
  af, zu, xh, st, ny, mg, so, ps, tk, ky,
  tg, tt, be, bs, fo, ee, lg, om, sd, su,
} as const;
