import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { getDb, DATABASE_NAME } from "../db";
import * as audioFilesRepo from "../db/repositories/audioFiles";
import * as blocksRepo from "../db/repositories/blocks";

// バックアップzipに含めるのは実データのみ(DB・結合済み音声・写真)。
// Documents/reports/ はblocksから都度再生成できるため対象外とする。
// Documents/audio・photos配下は、クラッシュ復旧の途中経過や削除漏れなどでDB未登録の
// 孤児ファイルが残っていることがあるため、ディレクトリを丸ごとコピーするのではなく、
// audio_files/blocksが実際に参照しているファイルだけを対象にする
async function copyReferencedFiles(uris: string[], destination: Directory): Promise<void> {
  const uniqueUris = [...new Set(uris)];
  if (uniqueUris.length === 0) return;
  destination.create({ intermediates: true, idempotent: true });
  for (const uri of uniqueUris) {
    try {
      const file = new File(uri);
      if (file.exists) await file.copy(destination);
    } catch (e) {
      console.warn("[Backup] ファイルのコピーに失敗しました", uri, e);
    }
  }
}

// react-native-zip-archiveはfile://スキームなしのプレーンなパスを想定しているため、
// expo-file-systemのuri(file://...)から変換する
function toPlainPath(uri: string): string {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}

function backupFileName(): string {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `reporoku_backup_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(
    now.getHours()
  )}${pad(now.getMinutes())}.zip`;
}

// バックアップ作成の間にDBへ書き込みが走っても、既にコピー済みのファイルには影響しないよう、
// zip化する一式は一旦キャッシュ配下の作業ディレクトリへコピーしてから固める
export async function createBackupZip(): Promise<File> {
  // WALモードでは未チェックポイントの変更がreporoku.db-wal側にだけ残っていることがあるため、
  // コピー前に本体ファイルへ書き戻しておく(失敗してもベストエフォートで続行)
  try {
    const db = await getDb();
    await db.execAsync("PRAGMA wal_checkpoint(TRUNCATE);");
  } catch (e) {
    console.warn("[Backup] WALチェックポイントに失敗しました", e);
  }

  const stagingDir = new Directory(Paths.cache, `backup_staging_${Date.now()}`);
  stagingDir.create({ intermediates: true, idempotent: true });

  try {
    const dbFile = new File(SQLite.defaultDatabaseDirectory, DATABASE_NAME);
    if (dbFile.exists) {
      await dbFile.copy(stagingDir);
    }

    const [audioFiles, photoUris] = await Promise.all([
      audioFilesRepo.listAll(),
      blocksRepo.listAllPhotoUris(),
    ]);
    await copyReferencedFiles(
      audioFiles.map((f) => f.fileUri),
      new Directory(stagingDir, "audio")
    );
    await copyReferencedFiles(photoUris, new Directory(stagingDir, "photos"));

    const { zip } = await import("react-native-zip-archive");
    const targetFile = new File(Paths.cache, backupFileName());
    await zip(toPlainPath(stagingDir.uri), toPlainPath(targetFile.uri));
    return targetFile;
  } finally {
    try {
      stagingDir.delete();
    } catch (e) {
      console.warn("[Backup] 作業用ディレクトリの削除に失敗しました", e);
    }
  }
}
