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
