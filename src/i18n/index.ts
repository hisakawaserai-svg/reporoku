import i18n from "i18next";
import { initReactI18next } from "react-i18next";
import * as Localization from "expo-localization";

import ja from "./locales/ja.json";
import en from "./locales/en.json";
import { getLanguagePreference, type LanguagePreference } from "../utils/settings";

export const SUPPORTED_LANGUAGES = ["ja", "en"] as const;
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number];

// 端末の言語設定から、アプリが対応する言語を決める。ja/en以外の端末言語はjaにフォールバックする
function detectDeviceLanguage(): SupportedLanguage {
  const code = Localization.getLocales()[0]?.languageCode;
  return code === "en" ? "en" : "ja";
}

function resolveLanguage(pref: LanguagePreference): SupportedLanguage {
  return pref === "system" ? detectDeviceLanguage() : pref;
}

i18n.use(initReactI18next).init({
  resources: {
    ja: { translation: ja },
    en: { translation: en },
  },
  lng: resolveLanguage(getLanguagePreference()),
  fallbackLng: "ja",
  interpolation: { escapeValue: false },
});

// 設定画面の言語切り替えから呼ぶ。「端末の設定に合わせる」が選ばれた場合は、その時点の端末言語を反映する
export function applyLanguagePreference(pref: LanguagePreference): void {
  i18n.changeLanguage(resolveLanguage(pref));
}

export default i18n;
