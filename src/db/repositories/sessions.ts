import { getDb } from '../index';
import type { MonthGroup, Session } from '../types';

interface SessionRow {
  id: string;
  title: string;
  started_at: number;
  duration_ms: number;
  created_at: number;
  updated_at: number;
}

function mapRow(row: SessionRow): Session {
  return {
    id: row.id,
    title: row.title,
    startedAt: row.started_at,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function monthKeyOf(unixMs: number): string {
  const d = new Date(unixMs);
  const year = d.getFullYear();
  const month = String(d.getMonth() + 1).padStart(2, '0');
  return `${year}-${month}`;
}

export interface CreateSessionInput {
  id: string;
  title?: string;
  startedAt: number;
  durationMs?: number;
}

export async function create(input: CreateSessionInput): Promise<Session> {
  const db = await getDb();
  const now = Date.now();
  const title = input.title ?? '';
  const durationMs = input.durationMs ?? 0;

  await db.runAsync(
    `INSERT INTO sessions (id, title, started_at, duration_ms, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [input.id, title, input.startedAt, durationMs, now, now]
  );

  return {
    id: input.id,
    title,
    startedAt: input.startedAt,
    durationMs,
    createdAt: now,
    updatedAt: now,
  };
}

export async function getById(id: string): Promise<Session | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<SessionRow>('SELECT * FROM sessions WHERE id = ?;', [id]);
  return row ? mapRow(row) : null;
}

export async function listAll(): Promise<Session[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<SessionRow>('SELECT * FROM sessions ORDER BY started_at DESC;');
  return rows.map(mapRow);
}

export async function listAllGroupedByMonth(): Promise<MonthGroup<Session>[]> {
  const sessions = await listAll();
  const groups: MonthGroup<Session>[] = [];
  const indexByMonth = new Map<string, number>();

  for (const session of sessions) {
    const monthKey = monthKeyOf(session.startedAt);
    let index = indexByMonth.get(monthKey);
    if (index === undefined) {
      index = groups.length;
      indexByMonth.set(monthKey, index);
      groups.push({ monthKey, items: [] });
    }
    groups[index].items.push(session);
  }

  return groups;
}

export async function updateTitle(id: string, title: string): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync('UPDATE sessions SET title = ?, updated_at = ? WHERE id = ?;', [title, now, id]);
}

export async function updateDuration(id: string, durationMs: number): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.runAsync('UPDATE sessions SET duration_ms = ?, updated_at = ? WHERE id = ?;', [
    durationMs,
    now,
    id,
  ]);
}

export async function deleteById(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM sessions WHERE id = ?;', [id]);
}
