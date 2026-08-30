import { getDb } from '../index';
import type { Block, BlockKind, BlockWithSession, QuestionKind, SearchResult } from '../types';
import { toAbsoluteUri, toStorableUri } from '../../utils/files';

interface BlockRow {
  id: string;
  session_id: string;
  kind: string;
  start_ms: number;
  end_ms: number | null;
  text: string | null;
  photo_uri: string | null;
  is_starred: number;
  is_todo: number;
  todo_done: number;
  is_question: number;
  question_term: string | null;
  question_kind: string | null;
  is_edited: number;
  created_at: number;
  summary_note: string | null;
  is_deferred: number;
  important_group: string | null;
}

interface BlockWithSessionRow extends BlockRow {
  session_title: string;
  session_started_at: number;
}

interface SearchResultRow extends BlockWithSessionRow {
  snippet: string;
}

function mapRow(row: BlockRow): Block {
  return {
    id: row.id,
    sessionId: row.session_id,
    kind: row.kind as BlockKind,
    startMs: row.start_ms,
    endMs: row.end_ms,
    text: row.text,
    photoUri: row.photo_uri ? toAbsoluteUri(row.photo_uri) : null,
    isStarred: row.is_starred === 1,
    isTodo: row.is_todo === 1,
    todoDone: row.todo_done === 1,
    isQuestion: row.is_question === 1,
    questionTerm: row.question_term,
    questionKind: row.question_kind as QuestionKind | null,
    isEdited: row.is_edited === 1,
    createdAt: row.created_at,
    summaryNote: row.summary_note,
    isDeferred: row.is_deferred === 1,
    importantGroup: row.important_group,
  };
}

function mapWithSessionRow(row: BlockWithSessionRow): BlockWithSession {
  return {
    ...mapRow(row),
    sessionTitle: row.session_title,
    sessionStartedAt: row.session_started_at,
  };
}

export interface CreateBlockInput {
  id: string;
  sessionId: string;
  kind: BlockKind;
  startMs: number;
  endMs?: number | null;
  text?: string | null;
  photoUri?: string | null;
  isStarred?: boolean;
  isTodo?: boolean;
  isQuestion?: boolean;
  questionTerm?: string | null;
  questionKind?: QuestionKind | null;
}

export async function create(input: CreateBlockInput): Promise<Block> {
  const db = await getDb();
  const now = Date.now();
  const endMs = input.endMs ?? null;
  const text = input.text ?? null;
  const photoUri = input.photoUri ?? null;
  const isStarred = input.isStarred ?? false;
  const isTodo = input.isTodo ?? false;
  const isQuestion = input.isQuestion ?? false;
  const questionTerm = input.questionTerm ?? null;
  const questionKind = input.questionKind ?? null;

  // documentDirectory相対のパスとして保存する(理由は toStorableUri のコメントを参照)
  await db.runAsync(
    `INSERT INTO blocks (
       id, session_id, kind, start_ms, end_ms, text, photo_uri,
       is_starred, is_todo, todo_done, is_question, question_term, question_kind,
       is_edited, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?, 0, ?);`,
    [
      input.id,
      input.sessionId,
      input.kind,
      input.startMs,
      endMs,
      text,
      photoUri ? toStorableUri(photoUri) : null,
      isStarred ? 1 : 0,
      isTodo ? 1 : 0,
      isQuestion ? 1 : 0,
      questionTerm,
      questionKind,
      now,
    ]
  );

  return {
    id: input.id,
    sessionId: input.sessionId,
    kind: input.kind,
    startMs: input.startMs,
    endMs,
    text,
    photoUri,
    isStarred,
    isTodo,
    todoDone: false,
    isQuestion,
    questionTerm,
    questionKind,
    isEdited: false,
    createdAt: now,
    summaryNote: null,
    isDeferred: false,
    importantGroup: null,
  };
}

export async function listBySessionId(sessionId: string): Promise<Block[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<BlockRow>(
    'SELECT * FROM blocks WHERE session_id = ? ORDER BY start_ms ASC;',
    [sessionId]
  );
  return rows.map(mapRow);
}

export async function update(id: string, text: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET text = ?, is_edited = 1 WHERE id = ?;', [text, id]);
}

export async function remove(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM blocks WHERE id = ?;', [id]);
}

// 写真が未設定のphotoブロック(プレースホルダー表示)に、後から写真を添付する
export async function setPhotoUri(id: string, photoUri: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET photo_uri = ? WHERE id = ?;', [toStorableUri(photoUri), id]);
}

export interface MergeFlags {
  isStarred: boolean;
  isTodo: boolean;
  todoDone: boolean;
  isQuestion: boolean;
  questionTerm: string | null;
  questionKind: QuestionKind | null;
  // 結合後のブロックは「早い方の開始〜遅い方の終了」の実測値になるため、
  // 遅い方(later)ブロックのendMsをそのまま引き継ぐ
  endMs: number | null;
}

// keepId側にmergedTextとflagsを反映し、removeId側を削除する(結合)
export async function mergeBlocks(
  keepId: string,
  removeId: string,
  mergedText: string,
  flags: MergeFlags
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE blocks
       SET text = ?, end_ms = ?, is_starred = ?, is_todo = ?, todo_done = ?, is_question = ?, question_term = ?, question_kind = ?, is_edited = 1
       WHERE id = ?;`,
      [
        mergedText,
        flags.endMs,
        flags.isStarred ? 1 : 0,
        flags.isTodo ? 1 : 0,
        flags.todoDone ? 1 : 0,
        flags.isQuestion ? 1 : 0,
        flags.questionTerm,
        flags.questionKind,
        keepId,
      ]
    );
    await db.runAsync('DELETE FROM blocks WHERE id = ?;', [removeId]);
  });
}

export interface SplitNewBlock {
  id: string;
  sessionId: string;
  kind: BlockKind;
  startMs: number;
  text: string;
}

// idのブロックをleftTextに書き換え、newBlockを新しい行として挿入する(分割)。
// 分割点の正確な発話終了時刻は分からないため、両方ともend_msはNULLにリセットし
// (間隔計算は文字数推定にフォールバックする)、★/ToDo/質問フラグも前半にのみ残す
export async function splitBlock(id: string, leftText: string, newBlock: SplitNewBlock): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync('UPDATE blocks SET text = ?, end_ms = NULL, is_edited = 1 WHERE id = ?;', [
      leftText,
      id,
    ]);
    await db.runAsync(
      `INSERT INTO blocks (
         id, session_id, kind, start_ms, end_ms, text, photo_uri,
         is_starred, is_todo, todo_done, is_question, question_term, question_kind,
         is_edited, created_at
       ) VALUES (?, ?, ?, ?, NULL, ?, NULL, 0, 0, 0, 0, NULL, NULL, 1, ?);`,
      [newBlock.id, newBlock.sessionId, newBlock.kind, newBlock.startMs, newBlock.text, now]
    );
  });
}

export async function toggleStar(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET is_starred = 1 - is_starred WHERE id = ?;', [id]);
}

export async function toggleTodo(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET is_todo = 1 - is_todo WHERE id = ?;', [id]);
}

// ★/📝と同じ「即座にマークするだけ」の挙動。question_termは「回答メモ」として
// 別管理のため、ここでは触れない
export async function toggleQuestion(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET is_question = 1 - is_question WHERE id = ?;', [id]);
}

export async function toggleTodoDone(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET todo_done = 1 - todo_done WHERE id = ?;', [id]);
}


export interface TodoGroups {
  pending: BlockWithSession[];
  done: BlockWithSession[];
}

export async function listAllTodos(): Promise<TodoGroups> {
  const db = await getDb();
  const rows = await db.getAllAsync<BlockWithSessionRow>(
    `SELECT blocks.*, sessions.title AS session_title, sessions.started_at AS session_started_at
     FROM blocks
     JOIN sessions ON sessions.id = blocks.session_id
     WHERE blocks.is_todo = 1
     ORDER BY blocks.created_at DESC;`
  );

  const pending: BlockWithSession[] = [];
  const done: BlockWithSession[] = [];
  for (const row of rows) {
    const block = mapWithSessionRow(row);
    (block.todoDone ? done : pending).push(block);
  }

  return { pending, done };
}

// ❓は「わからなかったこと全般」を記録する単一の機能。question_kindによる絞り込みは
// 行わず、is_question=1の全件を返す
export async function listAllQuestions(): Promise<BlockWithSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<BlockWithSessionRow>(
    `SELECT blocks.*, sessions.title AS session_title, sessions.started_at AS session_started_at
     FROM blocks
     JOIN sessions ON sessions.id = blocks.session_id
     WHERE blocks.is_question = 1
     ORDER BY blocks.created_at DESC;`
  );
  return rows.map(mapWithSessionRow);
}

// 「質問」タブでの回答メモ。question_termカラムを「回答メモ」として転用し、
// 空でなければ「解決済み」として扱う(専用カラムは追加しない)
export async function answerQuestion(id: string, answer: string): Promise<void> {
  const db = await getDb();
  const trimmed = answer.trim();
  await db.runAsync('UPDATE blocks SET question_term = ? WHERE id = ?;', [trimmed || null, id]);
}

// 「まとめ」画面の★重要セクション用。★のブロックを横断して集め、
// 発話時刻(セッション開始時刻+start_ms)の新しい順に返す
export async function listStarredBlocks(): Promise<BlockWithSession[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<BlockWithSessionRow>(
    `SELECT blocks.*, sessions.title AS session_title, sessions.started_at AS session_started_at
     FROM blocks
     JOIN sessions ON sessions.id = blocks.session_id
     WHERE blocks.is_starred = 1
     ORDER BY (sessions.started_at + blocks.start_ms) DESC;`
  );
  return rows.map(mapWithSessionRow);
}

// 「質問」タブの「保留にする/保留を解除する」。まとめ画面の未解決セクションからは
// 保留中の間だけ外れる(is_question/question_termはそのまま)
export async function setDeferred(id: string, deferred: boolean): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET is_deferred = ? WHERE id = ?;', [deferred ? 1 : 0, id]);
}

// 「まとめ」画面の★重要セクション、およびノート詳細画面での一言メモ。
// ❓の回答メモ(answerQuestion)と同じパターンで、空文字ならNULLに戻す
// (未記入=元の発言をそのまま表示、に戻せるようにする)
export async function setSummaryNote(id: string, note: string): Promise<void> {
  const db = await getDb();
  const trimmed = note.trim();
  await db.runAsync('UPDATE blocks SET summary_note = ? WHERE id = ?;', [trimmed || null, id]);
}

// 「まとめ」画面の★重要セクション用。★ブロックを、ノートをまたいで束ねるグループ名の
// 設定/解除(空文字ならNULLに戻す=未分類)
export async function setImportantGroup(id: string, group: string | null): Promise<void> {
  const db = await getDb();
  const trimmed = group?.trim() ?? '';
  await db.runAsync('UPDATE blocks SET important_group = ? WHERE id = ?;', [trimmed || null, id]);
}

export interface ImportantGroupSummary {
  name: string;
  count: number;
  latestAt: number;
  // 中身プレビュー用。選ぶ判断に必要な最小限として、最新1件の一言メモ(無ければ本文)のみ持つ
  latestSample: string | null;
}

// グループ割り当てのクイック選択用に、既存グループの一覧(重複無し、最近使われた順)を
// 中身のプレビュー(件数・最新の一言メモ)付きで返す
export async function listImportantGroupSummaries(): Promise<ImportantGroupSummary[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<{
    important_group: string;
    text: string | null;
    summary_note: string | null;
    created_at: number;
  }>(
    `SELECT important_group, text, summary_note, created_at
     FROM blocks
     WHERE important_group IS NOT NULL AND TRIM(important_group) != ''
     ORDER BY created_at DESC;`
  );

  const byName = new Map<string, ImportantGroupSummary>();
  for (const row of rows) {
    const name = row.important_group;
    let summary = byName.get(name);
    if (!summary) {
      const sample = (row.summary_note?.trim() || row.text?.trim() || '').trim();
      summary = { name, count: 0, latestAt: row.created_at, latestSample: sample || null };
      byName.set(name, summary);
    }
    summary.count += 1;
  }
  return [...byName.values()].sort((a, b) => b.latestAt - a.latestAt);
}

// タイトル一致行のスニペット用に、マッチ箇所をblocks_ftsのsnippet()と同じ'[' ']'記法で囲む
function highlightTitle(title: string, query: string): string {
  const idx = title.toLowerCase().indexOf(query.toLowerCase());
  if (idx === -1) return title;
  return `${title.slice(0, idx)}[${title.slice(idx, idx + query.length)}]${title.slice(
    idx + query.length
  )}`;
}

export async function search(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const db = await getDb();
  // trigramトークナイザは引用符で囲むと部分文字列検索として扱われる
  const ftsQuery = `"${trimmed.replace(/"/g, '""')}"`;
  const likeQuery = `%${trimmed.replace(/[\\%_]/g, '\\$&')}%`;

  const [textRows, titleRows] = await Promise.all([
    db.getAllAsync<SearchResultRow>(
      // 列番号を-1にすると、text/question_term(❓への回答)のうち実際にマッチした方から
      // スニペットを作る
      `SELECT blocks.*, sessions.title AS session_title, sessions.started_at AS session_started_at,
              snippet(blocks_fts, -1, '[', ']', '...', 12) AS snippet
       FROM blocks_fts
       JOIN blocks ON blocks.rowid = blocks_fts.rowid
       JOIN sessions ON sessions.id = blocks.session_id
       WHERE blocks_fts MATCH ?
       ORDER BY rank;`,
      [ftsQuery]
    ),
    // ノートのタイトル一致。ノート本文がヒットしていないセッションについて、そのノートの
    // 先頭ブロックを代表行として1件だけ返す(タイトルはblocks_ftsの対象外のため別クエリ)
    db.getAllAsync<BlockWithSessionRow>(
      `SELECT blocks.*, sessions.title AS session_title, sessions.started_at AS session_started_at
       FROM sessions
       JOIN blocks ON blocks.session_id = sessions.id
       WHERE sessions.title LIKE ? ESCAPE '\\'
         AND blocks.id = (
           SELECT b2.id FROM blocks b2
           WHERE b2.session_id = sessions.id
           ORDER BY b2.start_ms ASC, b2.created_at ASC
           LIMIT 1
         );`,
      [likeQuery]
    ),
  ]);

  const matchedSessionIds = new Set(textRows.map((row) => row.session_id));

  const titleResults = titleRows
    .filter((row) => !matchedSessionIds.has(row.session_id))
    .map((row) => ({
      ...mapWithSessionRow(row),
      snippet: highlightTitle(row.session_title, trimmed),
    }));

  const textResults = textRows.map((row) => ({
    ...mapWithSessionRow(row),
    snippet: row.snippet,
  }));

  return [...titleResults, ...textResults];
}
