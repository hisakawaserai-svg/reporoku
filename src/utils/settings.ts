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
}

// 選択できるセクション区切りの間隔(ms)。設定画面・録音画面・ノート詳細画面で共通して使う
export const SECTION_GAP_OPTIONS: { ms: number; label: string }[] = [
  { ms: 3000, label: "3秒" },
  { ms: 5000, label: "5秒(標準)" },
  { ms: 8000, label: "8秒" },
  { ms: 12000, label: "12秒" },
];

const DEFAULT_SETTINGS: AppSettings = {
  sectionGroupingEnabled: true,
  defaultSectionGapMs: 5000,
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
