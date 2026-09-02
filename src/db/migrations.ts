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
  {
    version: 4,
    sql: `
      ALTER TABLE blocks ADD COLUMN end_ms INTEGER;
    `,
  },
  {
    // question_termを❓の「回答(A)」として転用したため、全文検索の対象にも含める。
    // FTS5の外部コンテンツテーブルは列を後から追加できないため、作り直してrebuildする
    version: 5,
    sql: `
      DROP TRIGGER IF EXISTS blocks_ai;
      DROP TRIGGER IF EXISTS blocks_ad;
      DROP TRIGGER IF EXISTS blocks_au;
      DROP TABLE IF EXISTS blocks_fts;

      CREATE VIRTUAL TABLE blocks_fts USING fts5(
        text,
        question_term,
        content='blocks',
        content_rowid='rowid',
        tokenize='trigram'
      );

      INSERT INTO blocks_fts(blocks_fts) VALUES ('rebuild');

      CREATE TRIGGER blocks_ai AFTER INSERT ON blocks BEGIN
        INSERT INTO blocks_fts(rowid, text, question_term) VALUES (new.rowid, new.text, new.question_term);
      END;

      CREATE TRIGGER blocks_ad AFTER DELETE ON blocks BEGIN
        INSERT INTO blocks_fts(blocks_fts, rowid, text, question_term) VALUES ('delete', old.rowid, old.text, old.question_term);
      END;

      CREATE TRIGGER blocks_au AFTER UPDATE ON blocks BEGIN
        INSERT INTO blocks_fts(blocks_fts, rowid, text, question_term) VALUES ('delete', old.rowid, old.text, old.question_term);
        INSERT INTO blocks_fts(rowid, text, question_term) VALUES (new.rowid, new.text, new.question_term);
      END;
    `,
  },
  {
    // Todo/質問タブの「クイック追加」(録音を伴わない項目)専用の、非表示セッションを識別するフラグ
    version: 6,
    sql: `
      ALTER TABLE sessions ADD COLUMN is_quick INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // 「まとめ」画面の確認事項セクション用。★ブロックの元の発言を体言止めで要約した一言メモ
    version: 7,
    sql: `
      ALTER TABLE blocks ADD COLUMN summary_note TEXT;
    `,
  },
  {
    // 「まとめ」画面の「よく使うリスト」タブ用。★グループ(セッション単位)をピン留めできるようにする
    // (このタブ自体は後に廃止したが、カラムはそのまま残している)
    version: 8,
    sql: `
      ALTER TABLE sessions ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // 「質問」タブの「保留」グループ、および「まとめ」画面の未解決の質問セクション用。
    // ❓のうち、今は答えを探さない(一覧から一時的に外したい)ことを示すフラグ
    version: 9,
    sql: `
      ALTER TABLE blocks ADD COLUMN is_deferred INTEGER NOT NULL DEFAULT 0;
    `,
  },
  {
    // 「まとめ」画面・★重要セクション用。ノートをまたいで似た★をユーザーが自分で
    // 束ねられるように、任意のグループ名を持たせる(NULL=未分類)
    version: 10,
    sql: `
      ALTER TABLE blocks ADD COLUMN important_group TEXT;
    `,
  },
  {
    // ノート詳細画面のタイムラインで、セクション内の発言同士を同じ段落として詰めるかの閾値。
    // section_gap_msと同じくセッションごとに個別調整できるようにする(常にsection_gap_msより小さい値)
    version: 11,
    sql: `
      ALTER TABLE sessions ADD COLUMN paragraph_gap_ms INTEGER NOT NULL DEFAULT 1500;
    `,
  },
];
