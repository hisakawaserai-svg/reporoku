-- レポろく データベーススキーマ

CREATE TABLE IF NOT EXISTS sessions (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL DEFAULT '',
  started_at   INTEGER NOT NULL,      -- Unix時刻(ms)
  duration_ms  INTEGER NOT NULL DEFAULT 0,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL,
  section_gap_ms INTEGER NOT NULL DEFAULT 5000, -- タイムラインのセクション分け閾値(ms、migration v3)
  is_quick     INTEGER NOT NULL DEFAULT 0, -- Todo/質問タブの「クイック追加」専用の非表示セッションか(migration v6)
  is_pinned    INTEGER NOT NULL DEFAULT 0 -- (migration v8。参照するUI/機能は廃止済みだが、カラムは残している)
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
  is_question   INTEGER NOT NULL DEFAULT 0,  -- ❓(Q: このブロックのtextがそのまま質問内容になる)
  question_term TEXT,                  -- ❓への回答(A)。空なら未解決、値があれば解決済み(旧「わからなかった単語」欄を転用)
  question_kind TEXT,                  -- 使用しない(旧「質問/用語」区分。migration v2、カラムのみ残存)
  is_edited     INTEGER NOT NULL DEFAULT 0,
  created_at    INTEGER NOT NULL,
  summary_note  TEXT,                  -- 「まとめ」画面の★重要セクション用の一言メモ(migration v7)
  is_deferred   INTEGER NOT NULL DEFAULT 0, -- ❓を「保留」にしたか(migration v9)。まとめ画面の未解決セクション・質問タブの保留グループで使う
  important_group TEXT,                -- まとめ画面の★重要セクション用。ノートをまたいで束ねるための
                                        -- ユーザー任意のグループ名(migration v10)。NULLなら未分類
  FOREIGN KEY (session_id) REFERENCES sessions(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_blocks_session  ON blocks(session_id, start_ms);
CREATE INDEX IF NOT EXISTS idx_blocks_star     ON blocks(session_id, is_starred);
CREATE INDEX IF NOT EXISTS idx_blocks_todo     ON blocks(is_todo, todo_done);
CREATE INDEX IF NOT EXISTS idx_blocks_question ON blocks(is_question);

-- 全文検索用（日本語対応のtrigramトークナイザ）。question_term(❓への回答)も対象に含める(migration v5)
CREATE VIRTUAL TABLE IF NOT EXISTS blocks_fts USING fts5(
  text,
  question_term,
  content='blocks',
  content_rowid='rowid',
  tokenize='trigram'
);

-- blocks -> blocks_fts 同期トリガー
CREATE TRIGGER IF NOT EXISTS blocks_ai AFTER INSERT ON blocks BEGIN
  INSERT INTO blocks_fts(rowid, text, question_term) VALUES (new.rowid, new.text, new.question_term);
END;

CREATE TRIGGER IF NOT EXISTS blocks_ad AFTER DELETE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text, question_term) VALUES ('delete', old.rowid, old.text, old.question_term);
END;

CREATE TRIGGER IF NOT EXISTS blocks_au AFTER UPDATE ON blocks BEGIN
  INSERT INTO blocks_fts(blocks_fts, rowid, text, question_term) VALUES ('delete', old.rowid, old.text, old.question_term);
  INSERT INTO blocks_fts(rowid, text, question_term) VALUES (new.rowid, new.text, new.question_term);
END;
