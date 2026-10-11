.pragma library
.import "i18n/en.js" as L_en
.import "i18n/de.js" as L_de
.import "i18n/es.js" as L_es
.import "i18n/fr.js" as L_fr
.import "i18n/pt.js" as L_pt
.import "i18n/it.js" as L_it
.import "i18n/nl.js" as L_nl
.import "i18n/pl.js" as L_pl
.import "i18n/ru.js" as L_ru
.import "i18n/uk.js" as L_uk
.import "i18n/tr.js" as L_tr
.import "i18n/cs.js" as L_cs
.import "i18n/sv.js" as L_sv
.import "i18n/fi.js" as L_fi
.import "i18n/nb.js" as L_nb
.import "i18n/da.js" as L_da
.import "i18n/ro.js" as L_ro
.import "i18n/hu.js" as L_hu
.import "i18n/el.js" as L_el
.import "i18n/hi.js" as L_hi
.import "i18n/id.js" as L_id
.import "i18n/vi.js" as L_vi
.import "i18n/th.js" as L_th
.import "i18n/ja.js" as L_ja
.import "i18n/ko.js" as L_ko
.import "i18n/zh_CN.js" as L_zh_CN
.import "i18n/zh_TW.js" as L_zh_TW
.import "i18n/ar.js" as L_ar
.import "i18n/he.js" as L_he
.import "i18n/fa.js" as L_fa

// UI strings in 30 languages, one file each under i18n/ (the same set as More Time and
// More Weather). English is the base; every other catalogue is an overlay on it, so a
// missing key falls back to English instead of showing nothing. Action and label names
// in English and German live in Actions.js, the other languages add them here as
// act_<id> / label_<label> (Actions.actionName asks for them).

var catalogs = {
  en: L_en.catalog,
  de: L_de.catalog,
  es: L_es.catalog,
  fr: L_fr.catalog,
  pt: L_pt.catalog,
  it: L_it.catalog,
  nl: L_nl.catalog,
  pl: L_pl.catalog,
  ru: L_ru.catalog,
  uk: L_uk.catalog,
  tr: L_tr.catalog,
  cs: L_cs.catalog,
  sv: L_sv.catalog,
  fi: L_fi.catalog,
  nb: L_nb.catalog,
  da: L_da.catalog,
  ro: L_ro.catalog,
  hu: L_hu.catalog,
  el: L_el.catalog,
  hi: L_hi.catalog,
  id: L_id.catalog,
  vi: L_vi.catalog,
  th: L_th.catalog,
  ja: L_ja.catalog,
  ko: L_ko.catalog,
  zh_CN: L_zh_CN.catalog,
  zh_TW: L_zh_TW.catalog,
  ar: L_ar.catalog,
  he: L_he.catalog,
  fa: L_fa.catalog
}

// Each language in its own name, for the language picker.
var languageNames = {
  en: "English", de: "Deutsch", es: "Español", fr: "Français", pt: "Português", ru: "Русский",
  uk: "Українська", pl: "Polski", it: "Italiano", nl: "Nederlands", tr: "Türkçe", cs: "Čeština",
  sv: "Svenska", fi: "Suomi", nb: "Norsk bokmål", da: "Dansk", ro: "Română", hu: "Magyar",
  el: "Ελληνικά", zh_CN: "简体中文", zh_TW: "繁體中文", ja: "日本語", ko: "한국어", ar: "العربية",
  he: "עברית", fa: "فارسی", hi: "हिन्दी", id: "Bahasa Indonesia", vi: "Tiếng Việt", th: "ไทย"
}

var LANGUAGES = ["en", "de", "es", "fr", "pt", "it", "nl", "pl", "ru", "uk", "tr", "cs", "sv", "fi", "nb", "da", "ro", "hu", "el", "hi", "id", "vi", "th", "ja", "ko", "zh_CN", "zh_TW", "ar", "he", "fa"]

// A language code, or a locale name such as "de_DE" / "pt-BR" / "zh_TW.UTF-8", to the
// catalogue it uses; unknown ones get English.
function lang(l) {
  var raw = String(l || "en")
  if (Object.prototype.hasOwnProperty.call(catalogs, raw)) return raw
  var normalized = raw.toLowerCase().replace(/-/g, "_")
  var base = normalized.split(/[_.@]/)[0]
  if (base === "zh") {
    return normalized.indexOf("tw") >= 0 || normalized.indexOf("hk") >= 0
      || normalized.indexOf("mo") >= 0 || normalized.indexOf("hant") >= 0 ? "zh_TW" : "zh_CN"
  }
  // Legacy libc/Java aliases and the Norwegian variants.
  if (base === "iw") base = "he"
  if (base === "in") base = "id"
  if (base === "no" || base === "nn") base = "nb"
  return Object.prototype.hasOwnProperty.call(catalogs, base) ? base : "en"
}

function has(l, key) {
  return Object.prototype.hasOwnProperty.call(catalogs[lang(l)], key)
}

// The text for `key`, else the English one, else the key itself (visible, not blank).
function tr(l, key) {
  var table = catalogs[lang(l)]
  if (Object.prototype.hasOwnProperty.call(table, key)) return table[key]
  return Object.prototype.hasOwnProperty.call(catalogs.en, key) ? catalogs.en[key] : key
}

function languageName(code) { return languageNames[code] || code }

// Keys.comboFromText error code -> message.
function keyError(l, code) {
  var map = { "empty": "err_empty", "modifier": "err_modifier", "missing-key": "err_missingKey",
              "key": "err_key", "duplicate": "err_duplicate" }
  return tr(l, map[code] || "err_action")
}

// The English and German tables under their old name, for the tests.
var STRINGS = { en: catalogs.en, de: catalogs.de }

if (typeof module !== "undefined") module.exports = {
  STRINGS: STRINGS, catalogs: catalogs, LANGUAGES: LANGUAGES, languageNames: languageNames,
  lang: lang, has: has, tr: tr, languageName: languageName, keyError: keyError
}
