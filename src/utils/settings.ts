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
  // 初回起動オンボーディングを完了したか。trueなら次回以降は表示しない
  onboardingCompleted: boolean;
  // タップ再生時に、何秒手前から再生を開始するか(秒)
  playbackLeadSec: number;
  // 録音時のサンプルレート(Hz)
  recordingSampleRate: number;
  // オンにすると、接続中のBluetoothマイク(ワイヤレスイヤホン等)からの録音を許可する
  allowBluetoothMic: boolean;
}

// 選択できるセクション区切りの間隔(ms)。設定画面・録音画面・ノート詳細画面で共通して使う
export const SECTION_GAP_OPTIONS: { ms: number; label: string }[] = [
  { ms: 3000, label: "3秒" },
  { ms: 5000, label: "5秒(標準)" },
  { ms: 8000, label: "8秒" },
  { ms: 12000, label: "12秒" },
];

// 再生開始位置(lead秒数)の調整範囲・刻み幅・初期値
export const PLAYBACK_LEAD_MIN_SEC = 0;
export const PLAYBACK_LEAD_MAX_SEC = 5;
export const PLAYBACK_LEAD_STEP_SEC = 0.2;
export const PLAYBACK_LEAD_DEFAULT_SEC = 1.2;

// 選択できる録音サンプルレート(Hz)。設定画面・録音画面で共通して使う
export const SAMPLE_RATE_OPTIONS: { hz: number; label: string; hint: string }[] = [
  { hz: 16000, label: "標準(16000Hz)", hint: "容量を抑える(1時間あたり約115MB)" },
  { hz: 44100, label: "高音質(44100Hz)", hint: "容量が大きい(1時間あたり約300MB)" },
];

const DEFAULT_SETTINGS: AppSettings = {
  sectionGroupingEnabled: false,
  defaultSectionGapMs: 5000,
  onboardingCompleted: false,
  playbackLeadSec: PLAYBACK_LEAD_DEFAULT_SEC,
  recordingSampleRate: 16000,
  allowBluetoothMic: false,
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

export function setDefaultSectionGapMs(ms: number): void {
  saveSettings({ ...loadSettings(), defaultSectionGapMs: ms });
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
