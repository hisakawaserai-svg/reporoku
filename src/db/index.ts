import * as SQLite from 'expo-sqlite';
import { MIGRATIONS } from './migrations';

const DATABASE_NAME = 'reporoku.db';

let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

export function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = openAndMigrate();
  }
  return dbPromise;
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
