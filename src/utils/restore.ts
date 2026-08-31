import { Directory, File, Paths } from "expo-file-system";
import * as SQLite from "expo-sqlite";
import { withDbSuspended, DATABASE_NAME } from "../db";

const AUDIO_DIR_NAME = "audio";
const PHOTOS_DIR_NAME = "photos";

export class InvalidBackupError extends Error {}

// 復元処理の失敗後、退避データへのロールバックそのものにも失敗した場合に投げる。
// このケースでは呼び出し元は「元のデータは保持されています」とは案内できないため、
// 通常のRestore失敗と区別できるようにしている
export class RestoreRollbackFailedError extends Error {
  constructor(
    public readonly originalError: unknown,
    public readonly rollbackError: unknown
  ) {
    super("復元に失敗し、退避データへのロールバックにも失敗しました");
  }
}

// react-native-zip-archiveはfile://スキームなしのプレーンなパスを想定しているため、
// expo-file-systemのuri(file://...)から変換する
function toPlainPath(uri: string): string {
  return uri.startsWith("file://") ? uri.slice("file://".length) : uri;
}

function deleteIfExists(target: File | Directory): void {
  try {
    if (target.exists) target.delete();
  } catch (e) {
    console.warn("[Restore] 削除に失敗しました", target.uri, e);
  }
}

// audio・photosディレクトリはサブディレクトリを持たないフラットな構造のため、
// 直下のファイルだけをコピーすればよい
async function copyFlatDirectory(source: Directory, destination: Directory): Promise<void> {
  if (!source.exists) return;
  destination.create({ intermediates: true, idempotent: true });
  for (const entry of source.list()) {
    if (entry instanceof File) {
      await entry.copy(destination);
    }
  }
}

// バックアップzipを展開し、作成時と同じ構造(DBファイル・audio・photos)であることを
// 検証する。不正な場合はInvalidBackupErrorを投げ、展開先も削除して何も残さない
export async function extractAndValidateBackup(zipUri: string): Promise<Directory> {
  const extractDir = new Directory(Paths.cache, `restore_extract_${Date.now()}`);
  extractDir.create({ intermediates: true, idempotent: true });

  try {
    const { unzip } = await import("react-native-zip-archive");
    await unzip(toPlainPath(zipUri), toPlainPath(extractDir.uri));
  } catch (e) {
    deleteIfExists(extractDir);
    throw new InvalidBackupError("バックアップファイルが正しくありません");
  }

  const dbFile = new File(extractDir, DATABASE_NAME);
  if (!dbFile.exists) {
    deleteIfExists(extractDir);
    throw new InvalidBackupError("バックアップファイルが正しくありません");
  }

  return extractDir;
}

// 検証だけ済ませて復元を行わない場合(ユーザーがキャンセルした等)に、
// 展開先の作業ディレクトリを片付ける
export function discardExtractedBackup(extractDir: Directory): void {
  deleteIfExists(extractDir);
}

async function rollbackFromSafety(
  safetyDir: Directory,
  currentDbFile: File,
  currentAudioDir: Directory,
  currentPhotosDir: Directory
): Promise<void> {
  deleteIfExists(currentDbFile);
  const safetyDbFile = new File(safetyDir, DATABASE_NAME);
  if (safetyDbFile.exists) {
    await safetyDbFile.copy(new Directory(SQLite.defaultDatabaseDirectory));
  }

  deleteIfExists(currentAudioDir);
  currentAudioDir.create({ intermediates: true, idempotent: true });
  await copyFlatDirectory(new Directory(safetyDir, AUDIO_DIR_NAME), currentAudioDir);

  deleteIfExists(currentPhotosDir);
  currentPhotosDir.create({ intermediates: true, idempotent: true });
  await copyFlatDirectory(new Directory(safetyDir, PHOTOS_DIR_NAME), currentPhotosDir);
}

// 展開済みのバックアップで現在のDB・音声・写真を置き換える。
// 失敗時に元のデータを失わないよう、置き換え前に現在のデータを退避しておき、
// 途中で失敗した場合は退避データへ戻す
export async function applyBackup(extractDir: Directory): Promise<void> {
  const dbFile = new File(extractDir, DATABASE_NAME);
  const audioDir = new Directory(extractDir, AUDIO_DIR_NAME);
  const photosDir = new Directory(extractDir, PHOTOS_DIR_NAME);

  const currentDbFile = new File(SQLite.defaultDatabaseDirectory, DATABASE_NAME);
  const currentAudioDir = new Directory(Paths.document, AUDIO_DIR_NAME);
  const currentPhotosDir = new Directory(Paths.document, PHOTOS_DIR_NAME);

  const safetyDir = new Directory(Paths.cache, `restore_safety_${Date.now()}`);
  safetyDir.create({ intermediates: true, idempotent: true });

  // 復元が終わるまでの間、他の画面がgetDb()で新しい接続を開かないようにする
  // (置き換え中のファイルへの同時アクセスによるクラッシュを防ぐ)
  try {
    await withDbSuspended(async () => {
      if (currentDbFile.exists) {
        await currentDbFile.copy(safetyDir);
      }
      await copyFlatDirectory(currentAudioDir, new Directory(safetyDir, AUDIO_DIR_NAME));
      await copyFlatDirectory(currentPhotosDir, new Directory(safetyDir, PHOTOS_DIR_NAME));

      try {
        // WAL/SHMファイルが残っていると、復元したDB本体との不整合を起こすため先に削除する
        deleteIfExists(new File(SQLite.defaultDatabaseDirectory, `${DATABASE_NAME}-wal`));
        deleteIfExists(new File(SQLite.defaultDatabaseDirectory, `${DATABASE_NAME}-shm`));
        deleteIfExists(currentDbFile);
        await dbFile.copy(new Directory(SQLite.defaultDatabaseDirectory));

        deleteIfExists(currentAudioDir);
        await copyFlatDirectory(audioDir, currentAudioDir);

        deleteIfExists(currentPhotosDir);
        await copyFlatDirectory(photosDir, currentPhotosDir);
      } catch (e) {
        try {
          await rollbackFromSafety(safetyDir, currentDbFile, currentAudioDir, currentPhotosDir);
        } catch (rollbackError) {
          console.warn("[Restore] 退避データへの復元にも失敗しました", rollbackError);
          throw new RestoreRollbackFailedError(e, rollbackError);
        }
        throw e;
      }
    });
  } finally {
    deleteIfExists(extractDir);
    deleteIfExists(safetyDir);
  }
}
