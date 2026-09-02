import { File, Paths } from "expo-file-system";

// アプリ全体の設定を documentDirectory 直下のJSONファイルに保存する。
// blocks/sessionsのようなユーザーの記録データではなく、端末ローカルのUI設定のため、
// DBのテーブルにはせず軽量なファイル保存にしている
const settingsFile = new File(Paths.document, "settings.json");

export interface AppSettings {
  sectionGroupingEnabled: boolean;
  // 新しい録音を開始した時、そのセッションのsection_gap_msの初期値として使う(ms)。
  // 各セッションはこの値を個別に持つため、ここでの変更は既存セッションには影響しない
  defaultSectionGapMs: number;
  // 新しい録音を開始した時、そのセッションのparagraph_gap_msの初期値として使う(ms)。
  // 常にdefaultSectionGapMsより小さい値でなければならない(setDefaultParagraphGapMs内でクランプする)
  defaultParagraphGapMs: number;
  // 初回起動オンボーディングを完了したか。trueなら次回以降は表示しない
  onboardingCompleted: boolean;
  // タップ再生時に、何秒手前から再生を開始するか(秒)
  playbackLeadSec: number;
  // 録音時のサンプルレート(Hz)
  recordingSampleRate: number;
  // オンにすると、接続中のBluetoothマイク(ワイヤレスイヤホン等)からの録音を許可する
  allowBluetoothMic: boolean;
  // アプリの表示言語。"system"は端末の言語設定に自動で合わせる(既定値)
  languagePreference: LanguagePreference;
  // 音声認識(文字起こし)の対象言語(BCP-47)。表示言語(languagePreference)とは独立しており、
  // 自動連動しない。既定値は日本語
  speechRecognitionLanguage: string;
}

export type LanguagePreference = "system" | "ja" | "en";

// 選択できる音声認識の対象言語。設定画面のセレクタで使う。将来言語を追加する場合はここに足すだけでよい
export const SPEECH_RECOGNITION_LANGUAGE_OPTIONS: { code: string; labelKey: string }[] = [
  { code: "ja-JP", labelKey: "settings.language.japanese" },
  { code: "en-US", labelKey: "settings.language.english" },
];

// セクション区切り(「区切りの細かさ」スライダー)の調整範囲・刻み幅。
// 設定画面(既定値)・ノート詳細画面(ノートごとの値)の両方のスライダーで共通して使う
export const SECTION_GAP_MIN_MS = 1500;
export const SECTION_GAP_MAX_MS = 8000;
export const SECTION_GAP_STEP_MS = 500;

// 段落の改行(「改行の細かさ」スライダー)の調整範囲・刻み幅。上限は固定値ではなく、
// その時点のセクション区切りの値から動的に決まる(paragraphGapMaxMsを参照)
export const PARAGRAPH_GAP_MIN_MS = 500;
export const PARAGRAPH_GAP_STEP_MS = 500;

// 「改行の細かさ」スライダーが選べる上限(ms)。「区切りの細かさ」より必ず小さい値にする
// (例: セクションが5.0秒なら、改行は4.5秒までしか選べない)
export function paragraphGapMaxMs(sectionGapMs: number): number {
  return Math.max(PARAGRAPH_GAP_MIN_MS, sectionGapMs - PARAGRAPH_GAP_STEP_MS);
}

// アプリ本来の初期値(ユーザーがまだ何も変更していない状態の値)。設定画面のスライダーに
// 「基準の印」として表示するためだけに使う定数で、DEFAULT_SETTINGSの値とは役割が異なる
// (DEFAULT_SETTINGSはユーザーが変更しうる「現在のデフォルト値」、こちらは変わらない目印)
export const SECTION_GAP_FACTORY_DEFAULT_MS = 5000;
export const PARAGRAPH_GAP_FACTORY_DEFAULT_MS = 1500;

// セクション区切りの値が変わった際、既存の改行の値がその新しい上限を超えていれば切り詰める
export function clampParagraphGapMs(paragraphGapMs: number, sectionGapMs: number): number {
  return Math.min(paragraphGapMs, paragraphGapMaxMs(sectionGapMs));
}

// 再生開始位置(lead秒数)の調整範囲・刻み幅・初期値
export const PLAYBACK_LEAD_MIN_SEC = 0;
export const PLAYBACK_LEAD_MAX_SEC = 5;
export const PLAYBACK_LEAD_STEP_SEC = 0.2;
export const PLAYBACK_LEAD_DEFAULT_SEC = 1.2;

// 選択できる録音サンプルレート(Hz)。設定画面・録音画面で共通して使う
export const SAMPLE_RATE_OPTIONS: { hz: number; labelKey: string; hintKey: string }[] = [
  { hz: 16000, labelKey: "settings.sampleRate.standard.label", hintKey: "settings.sampleRate.standard.hint" },
  { hz: 44100, labelKey: "settings.sampleRate.high.label", hintKey: "settings.sampleRate.high.hint" },
];

const DEFAULT_SETTINGS: AppSettings = {
  sectionGroupingEnabled: false,
  defaultSectionGapMs: 5000,
  defaultParagraphGapMs: 1500,
  onboardingCompleted: false,
  playbackLeadSec: PLAYBACK_LEAD_DEFAULT_SEC,
  recordingSampleRate: 16000,
  allowBluetoothMic: false,
  languagePreference: "system",
  speechRecognitionLanguage: "ja-JP",
};

// 起動中に何度も呼ばれても毎回ファイルI/Oが走らないよう、読み込み結果を保持する
let cached: AppSettings | null = null;

function loadSettings(): AppSettings {
  if (cached) return cached;
  let loaded: AppSettings;
  try {
    if (settingsFile.exists) {
      const raw = settingsFile.textSync();
      loaded = { ...DEFAULT_SETTINGS, ...JSON.parse(raw) };
    } else {
      loaded = { ...DEFAULT_SETTINGS };
    }
  } catch (e) {
    console.warn("[Settings] 設定の読み込みに失敗しました。既定値を使用します", e);
    loaded = { ...DEFAULT_SETTINGS };
  }
  cached = loaded;
  return loaded;
}

function saveSettings(next: AppSettings): void {
  cached = next;
  try {
    settingsFile.create({ overwrite: true });
    settingsFile.write(JSON.stringify(next));
  } catch (e) {
    console.warn("[Settings] 設定の保存に失敗しました", e);
  }
}

export function getSectionGroupingEnabled(): boolean {
  return loadSettings().sectionGroupingEnabled;
}

export function setSectionGroupingEnabled(enabled: boolean): void {
  saveSettings({ ...loadSettings(), sectionGroupingEnabled: enabled });
}

export function getDefaultSectionGapMs(): number {
  return loadSettings().defaultSectionGapMs;
}

// セクション区切りの既定値を変更する。改行の既定値がその時点で新しい上限を超えていれば、
// 「改行は常にセクションより小さい値」の制約を保つため一緒に切り詰める
export function setDefaultSectionGapMs(ms: number): void {
  const current = loadSettings();
  saveSettings({
    ...current,
    defaultSectionGapMs: ms,
    defaultParagraphGapMs: clampParagraphGapMs(current.defaultParagraphGapMs, ms),
  });
}

export function getDefaultParagraphGapMs(): number {
  return loadSettings().defaultParagraphGapMs;
}

export function setDefaultParagraphGapMs(ms: number): void {
  const current = loadSettings();
  saveSettings({ ...current, defaultParagraphGapMs: clampParagraphGapMs(ms, current.defaultSectionGapMs) });
}

export function getOnboardingCompleted(): boolean {
  return loadSettings().onboardingCompleted;
}

export function setOnboardingCompleted(completed: boolean): void {
  saveSettings({ ...loadSettings(), onboardingCompleted: completed });
}

export function getPlaybackLeadSec(): number {
  return loadSettings().playbackLeadSec;
}

export function setPlaybackLeadSec(sec: number): void {
  saveSettings({ ...loadSettings(), playbackLeadSec: sec });
}

export function getRecordingSampleRate(): number {
  return loadSettings().recordingSampleRate;
}

export function setRecordingSampleRate(hz: number): void {
  saveSettings({ ...loadSettings(), recordingSampleRate: hz });
}

export function getAllowBluetoothMic(): boolean {
  return loadSettings().allowBluetoothMic;
}

export function setAllowBluetoothMic(enabled: boolean): void {
  saveSettings({ ...loadSettings(), allowBluetoothMic: enabled });
}

export function getLanguagePreference(): LanguagePreference {
  return loadSettings().languagePreference;
}

export function setLanguagePreference(pref: LanguagePreference): void {
  saveSettings({ ...loadSettings(), languagePreference: pref });
}

export function getSpeechRecognitionLanguage(): string {
  return loadSettings().speechRecognitionLanguage;
}

// 録音中に音声認識の言語が変更された場合、RecordScreen側がその場でセッションを
// 再起動できるよう、変更を購読できるようにする(録音していない時は誰も購読しておらず、
// 単に次回の録音開始時に新しい値が使われるだけになる)
type SpeechRecognitionLanguageListener = (code: string) => void;
const speechRecognitionLanguageListeners = new Set<SpeechRecognitionLanguageListener>();

export function onSpeechRecognitionLanguageChange(listener: SpeechRecognitionLanguageListener): () => void {
  speechRecognitionLanguageListeners.add(listener);
  return () => {
    speechRecognitionLanguageListeners.delete(listener);
  };
}

export function setSpeechRecognitionLanguage(code: string): void {
  saveSettings({ ...loadSettings(), speechRecognitionLanguage: code });
  speechRecognitionLanguageListeners.forEach((listener) => listener(code));
}
