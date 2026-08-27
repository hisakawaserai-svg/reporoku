import { getDb } from '../index';
import type { Block, BlockKind, BlockWithSession, SearchResult } from '../types';
import { toAbsoluteUri, toStorableUri } from '../../utils/files';

interface BlockRow {
  id: string;
  session_id: string;
  kind: string;
  start_ms: number;
  text: string | null;
  photo_uri: string | null;
  is_starred: number;
  is_todo: number;
  todo_done: number;
  is_question: number;
  question_term: string | null;
  is_edited: number;
  created_at: number;
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
    text: row.text,
    photoUri: row.photo_uri ? toAbsoluteUri(row.photo_uri) : null,
    isStarred: row.is_starred === 1,
    isTodo: row.is_todo === 1,
    todoDone: row.todo_done === 1,
    isQuestion: row.is_question === 1,
    questionTerm: row.question_term,
    isEdited: row.is_edited === 1,
    createdAt: row.created_at,
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
  text?: string | null;
  photoUri?: string | null;
  isStarred?: boolean;
  isTodo?: boolean;
  isQuestion?: boolean;
  questionTerm?: string | null;
}

export async function create(input: CreateBlockInput): Promise<Block> {
  const db = await getDb();
  const now = Date.now();
  const text = input.text ?? null;
  const photoUri = input.photoUri ?? null;
  const isStarred = input.isStarred ?? false;
  const isTodo = input.isTodo ?? false;
  const isQuestion = input.isQuestion ?? false;
  const questionTerm = input.questionTerm ?? null;

  // documentDirectory相対のパスとして保存する(理由は toStorableUri のコメントを参照)
  await db.runAsync(
    `INSERT INTO blocks (
       id, session_id, kind, start_ms, text, photo_uri,
       is_starred, is_todo, todo_done, is_question, question_term,
       is_edited, created_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?, 0, ?);`,
    [
      input.id,
      input.sessionId,
      input.kind,
      input.startMs,
      text,
      photoUri ? toStorableUri(photoUri) : null,
      isStarred ? 1 : 0,
      isTodo ? 1 : 0,
      isQuestion ? 1 : 0,
      questionTerm,
      now,
    ]
  );

  return {
    id: input.id,
    sessionId: input.sessionId,
    kind: input.kind,
    startMs: input.startMs,
    text,
    photoUri,
    isStarred,
    isTodo,
    todoDone: false,
    isQuestion,
    questionTerm,
    isEdited: false,
    createdAt: now,
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

export async function toggleStar(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET is_starred = 1 - is_starred WHERE id = ?;', [id]);
}

export async function toggleTodo(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET is_todo = 1 - is_todo WHERE id = ?;', [id]);
}

export async function toggleTodoDone(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET todo_done = 1 - todo_done WHERE id = ?;', [id]);
}

export async function setQuestion(
  id: string,
  isQuestion: boolean,
  questionTerm: string | null = null
): Promise<void> {
  const db = await getDb();
  await db.runAsync('UPDATE blocks SET is_question = ?, question_term = ? WHERE id = ?;', [
    isQuestion ? 1 : 0,
    questionTerm,
    id,
  ]);
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

export async function search(query: string): Promise<SearchResult[]> {
  const trimmed = query.trim();
  if (!trimmed) return [];

  const db = await getDb();
  // trigramトークナイザは引用符で囲むと部分文字列検索として扱われる
  const ftsQuery = `"${trimmed.replace(/"/g, '""')}"`;

  const rows = await db.getAllAsync<SearchResultRow>(
    `SELECT blocks.*, sessions.title AS session_title, sessions.started_at AS session_started_at,
            snippet(blocks_fts, 0, '[', ']', '...', 12) AS snippet
     FROM blocks_fts
     JOIN blocks ON blocks.rowid = blocks_fts.rowid
     JOIN sessions ON sessions.id = blocks.session_id
     WHERE blocks_fts MATCH ?
     ORDER BY rank;`,
    [ftsQuery]
  );

  return rows.map((row) => ({
    ...mapWithSessionRow(row),
    snippet: row.snippet,
  }));
}
