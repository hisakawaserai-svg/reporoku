export interface Migration {
  version: number;
  sql: string;
}

// 各バージョンのSQLは src/db/schema.sql の内容と対応させること。
export const MIGRATIONS: Migration[] = [
  {
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS sessions (
        id           TEXT PRIMARY KEY,
        title        TEXT NOT NULL DEFAULT '',
        started_at   INTEGER NOT NULL,
        duration_ms  INTEGER NOT NULL DEFAULT 0,
        created_at   INTEGER NOT NULL,
        updated_at   INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS audio_files (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        file_uri      TEXT NOT NULL,
        seq           INTEGER NOT NULL,
        offset_ms     INTEGER NOT NULL,
        duration_ms   INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE TABLE IF NOT EXISTS blocks (
        id            TEXT PRIMARY KEY,
        session_id    TEXT NOT NULL,
        kind          TEXT NOT NULL,
        start_ms      INTEGER NOT NULL,
        text          TEXT,
        photo_uri     TEXT,
        is_starred    INTEGER NOT NULL DEFAULT 0,
        is_todo       INTEGER NOT NULL DEFAULT 0,
        todo_done     INTEGER NOT NULL DEFAULT 0,
        is_question   INTEGER NOT NULL DEFAULT 0,
        question_term TEXT,
        is_edited     INTEGER NOT NULL DEFAULT 0,
        created_at    INTEGER NOT NULL,
        FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_blocks_session  ON blocks(session_id, start_ms);
      CREATE INDEX IF NOT EXISTS idx_blocks_star     ON blocks(session_id, is_starred);
      CREATE INDEX IF NOT EXISTS idx_blocks_todo     ON blocks(is_todo, todo_done);
      CREATE INDEX IF NOT EXISTS idx_blocks_question ON blocks(is_question);

      CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
        text,
        content='blocks',
        content_rowid='rowid',
        tokenize='trigram'
      );

      CREATE TRIGGER IF NOT EXISTS blocks_ai AFTER INSERT ON blocks BEGIN
        INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
      END;

      CREATE TRIGGER IF NOT EXISTS blocks_ad AFTER DELETE ON blocks BEGIN
        INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
      END;

      CREATE TRIGGER IF NOT EXISTS blocks_au AFTER UPDATE ON blocks BEGIN
        INSERT INTO blocks_fts(blocks_fts, rowid, text) VALUES ('delete', old.rowid, old.text);
        INSERT INTO blocks_fts(rowid, text) VALUES (new.rowid, new.text);
      END;
    `,
  },
  {
    version: 2,
    sql: `
      ALTER TABLE blocks ADD COLUMN question_kind TEXT;
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE sessions ADD COLUMN section_gap_ms INTEGER NOT NULL DEFAULT 5000;
    `,
  },
];
