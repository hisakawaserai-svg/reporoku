-- レポろく データベーススキーマ

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  started_at   INTEGER NOT NULL,      -- Unix時刻(ms)
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  section_gap_ms INTEGER NOT NULL DEFAULT 5000 -- タイムラインのセクション分け閾値(ms、migration v3)
);

CREATE TABLE IF NOT EXISTS audio_files (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  file_uri      TEXT NOT NULL,
  seq           INTEGER NOT NULL,     -- 何本目か(0始まり)
  offset_ms     INTEGER NOT NULL,     -- セッション開始から何ms地点で始まったか
  duration_ms   INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS blocks (
  id            TEXT PRIMARY KEY,
  session_id    TEXT NOT NULL,
  kind          TEXT NOT NULL,        -- 'transcript' | 'note' | 'photo'
  start_ms      INTEGER NOT NULL,     -- セッション開始からの経過ms(発話開始の実測値)
  end_ms        INTEGER,              -- 発話終了の実測値(ms、migration v4)。transcriptのみ録音時に記録。
                                       -- NULLの場合はセクション分けの間隔計算で文字数からの推定にフォールバックする
  text          TEXT,
  photo_uri     TEXT,
  is_starred    INTEGER NOT NULL DEFAULT 0,  -- ★
  is_todo       INTEGER NOT NULL DEFAULT 0,  -- 📝
  todo_done     INTEGER NOT NULL DEFAULT 0,
  is_question   INTEGER NOT NULL DEFAULT 0,  -- ❓
  question_term TEXT,                  -- ❓に紐づく「わからなかった単語」(question_kind='term'の場合のみ使用)
  question_kind TEXT,                  -- is_question=trueの時のみ使用: 'question' | 'term' (migration v2)
  is_edited     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blocks_session  ON blocks(session_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_blocks_star     ON blocks(session_id, is_starred);
CREATE INDEX IF NOT EXISTS idx_blocks_todo     ON blocks(is_todo, todo_done);
CREATE INDEX IF NOT EXISTS idx_blocks_question ON blocks(is_question);

-- 全文検索用（日本語対応のtrigramトークナイザ）
CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
  text,
  content='blocks',
  content_rowid='rowid',
  tokenize='trigram'
);

-- blocks -> blocks_fts 同期トリガー
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
