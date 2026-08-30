import * as SQLite from 'expo-sqlite';
import { MIGRATIONS } from './migrations';

export const DATABASE_NAME = 'reporoku.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;
// バックアップ復元でDBファイルを置き換えている間、他の画面(録音中の音声認識結果の保存など)が
// getDb()経由で新しい接続を開いてしまうと、置き換え中のファイルに対して同時アクセスが発生し
// ネイティブ層のクラッシュにつながる。復元中はgetDb()の解決を待たせて、この競合を防ぐ
let suspendedUntil: Promise<void> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (suspendedUntil) {
    return suspendedUntil.then(() => getDb());
  }
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
}

// バックアップ復元用: fn()の実行中はgetDb()の呼び出しを全て待たせることで、DBファイルの
// 置き換え中に他のコードが新しい接続を開いてしまうことを防ぐ。
// 既存の接続はここで明示的にcloseAsync()せず、参照を手放すだけにする。他のコードで
// 実行中のクエリと同時にcloseAsync()を呼ぶと、ネイティブ層でのDB破棄と衝突してクラッシュ
// することがあるため(実機で確認済み)。置き換え後のファイルはgetDb()が次に呼ばれた時点で
// 新規に開き直されるので問題ない。手放した古い接続はアプリを再起動するまで生き残るが、
// 復元完了後にユーザーへ再起動を促しているため実害はない
export async function withDbSuspended<T>(fn: () => Promise<T>): Promise<T> {
  let release!: () => void;
  suspendedUntil = new Promise((resolve) => {
    release = resolve;
  });
  dbPromise = null;
  try {
    return await fn();
  } finally {
    suspendedUntil = null;
    release();
  }
}

async function openAndMigrate(): Promise<SQLite.SQLiteDatabase> {
  const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
  await db.execAsync('PRAGMA foreign_keys = ON;');
  await migrate(db);
  return db;
}

async function migrate(db: SQLite.SQLiteDatabase): Promise<void> {
  const targetVersion = MIGRATIONS.length;
  const row = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version;');
  const currentVersion = row?.user_version ?? 0;

  for (let version = currentVersion + 1; version <= targetVersion; version++) {
    const migration = MIGRATIONS.find((m) => m.version === version);
    if (!migration) {
      throw new Error(`マイグレーション定義が見つかりません: version ${version}`);
    }
    await db.withTransactionAsync(async () => {
      await db.execAsync(migration.sql);
    });
    await db.execAsync(`PRAGMA user_version = ${version};`);
  }
}
