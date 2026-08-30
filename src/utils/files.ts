import { Directory, File, Paths } from "expo-file-system";

// iOSの cache ディレクトリはOSが容量不足時に自動削除することがあるため、
// 写真・音声は documentDirectory 配下の固定ディレクトリに永続保存する。
const photosDirectory = new Directory(Paths.document, "photos");
const audioDirectory = new Directory(Paths.document, "audio");

function ensureDirectory(dir: Directory): Directory {
  if (!dir.exists) {
    dir.create({ intermediates: true, idempotent: true });
  }
  return dir;
}

export function getAudioDirectoryUri(): string {
  return ensureDirectory(audioDirectory).uri;
}

export interface AudioDirectoryEntry {
  uri: string;
  lastModified: number;
}

function listFileEntries(dir: Directory): AudioDirectoryEntry[] {
  return ensureDirectory(dir)
    .list()
    .filter((entry): entry is File => entry instanceof File)
    .map((file) => ({ uri: file.uri, lastModified: file.lastModified ?? 0 }));
}

// audio/ ディレクトリ直下のファイル一覧を、更新日時つきで返す(クラッシュ復旧時に
// DB未登録のファイルを探すために使う。サブディレクトリは対象外)
export function listAudioDirectoryEntries(): AudioDirectoryEntry[] {
  return listFileEntries(audioDirectory);
}

// photos/ ディレクトリ直下のファイル一覧を、更新日時つきで返す(ストレージ管理画面の
// 孤児ファイル検出に使う。サブディレクトリは対象外)
export function listPhotosDirectoryEntries(): AudioDirectoryEntry[] {
  return listFileEntries(photosDirectory);
}

// documentDirectory の絶対パス(iOSではコンテナのUUIDを含む)は、アプリの再インストール・
// 再ビルドのたびに変わりうる。DBに絶対パスのまま保存すると、次にビルドし直しただけで
// 過去の音声・写真が読み込めなくなるため、保存時は documentDirectory 相対のパスに変換する。
export function toStorableUri(absoluteUri: string): string {
  const base = Paths.document.uri;
  return absoluteUri.startsWith(base) ? absoluteUri.slice(base.length) : absoluteUri;
}

// 保存された相対パスを、現在のdocumentDirectoryを基準にした絶対パスへ復元する。
// "file://" 等で始まる絶対パス(相対パス化より前の古いデータ)はそのまま返す。
export function toAbsoluteUri(storedUri: string): string {
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(storedUri)) return storedUri;
  return Paths.document.uri + storedUri;
}

// expo-image-picker の撮影結果(cache URI)を永続ディレクトリへコピーし、コピー後のURIを返す。
// ファイル名の衝突を避けるため、セッションIDとタイムスタンプを含める。
export async function persistPhotoFile(sourceUri: string, sessionId: string): Promise<string> {
  const dir = ensureDirectory(photosDirectory);
  const source = new File(sourceUri);
  const fileName = `${sessionId}_${Date.now()}${source.extension || ".jpg"}`;
  const destination = new File(dir, fileName);
  await source.copy(destination);
  return destination.uri;
}

// ブロック/セッション削除時に、対応する写真・音声ファイルが孤児化しないよう削除する。
// 失敗してもDB側の削除自体は既に完了しているはずなので、ここでは握りつぶして警告のみ出す
export async function deleteStoredFile(absoluteUri: string): Promise<void> {
  try {
    const file = new File(absoluteUri);
    if (file.exists) {
      await file.delete();
    }
  } catch (e) {
    console.warn("[FS] ファイルの削除に失敗しました", e);
  }
}
