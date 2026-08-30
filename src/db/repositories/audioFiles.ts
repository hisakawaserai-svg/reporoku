import { getDb } from '../index';
import type { AudioFile } from '../types';
import { toAbsoluteUri, toStorableUri } from '../../utils/files';

interface AudioFileRow {
  id: string;
  session_id: string;
  file_uri: string;
  seq: number;
  offset_ms: number;
  duration_ms: number;
}

function mapRow(row: AudioFileRow): AudioFile {
  return {
    id: row.id,
    sessionId: row.session_id,
    fileUri: toAbsoluteUri(row.file_uri),
    seq: row.seq,
    offsetMs: row.offset_ms,
    durationMs: row.duration_ms,
  };
}

export interface CreateAudioFileInput {
  id: string;
  sessionId: string;
  fileUri: string;
  seq: number;
  offsetMs: number;
  durationMs: number;
}

export async function create(input: CreateAudioFileInput): Promise<AudioFile> {
  const db = await getDb();
  // documentDirectory相対のパスとして保存する(理由は toStorableUri のコメントを参照)
  await db.runAsync(
    `INSERT INTO audio_files (id, session_id, file_uri, seq, offset_ms, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [input.id, input.sessionId, toStorableUri(input.fileUri), input.seq, input.offsetMs, input.durationMs]
  );

  return { ...input };
}

export async function listBySessionId(sessionId: string): Promise<AudioFile[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AudioFileRow>(
    'SELECT * FROM audio_files WHERE session_id = ? ORDER BY seq ASC;',
    [sessionId]
  );
  return rows.map(mapRow);
}

// ストレージ管理画面向け。全セッション分のaudio_filesを一括で返す
export async function listAll(): Promise<AudioFile[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<AudioFileRow>('SELECT * FROM audio_files ORDER BY session_id, seq ASC;');
  return rows.map(mapRow);
}

// ストレージ管理画面の「音声のみ削除」。blocksのテキスト記録は残したまま、
// そのノートのaudio_filesレコードだけを削除する(実ファイルの削除は呼び出し側で行う)
export async function deleteBySessionId(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM audio_files WHERE session_id = ?;', [sessionId]);
}

// ストレージ管理画面の「音声データを一括削除」用
export async function deleteAll(): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM audio_files;');
}

// クラッシュ復旧時、ディスク上のどのファイルが未登録(孤児)かを判定するために、
// 全セッション分の登録済みfile_uriだけを軽量に取得する
export async function listAllFileUris(): Promise<Set<string>> {
  const db = await getDb();
  const rows = await db.getAllAsync<{ file_uri: string }>('SELECT file_uri FROM audio_files;');
  return new Set(rows.map((r) => toAbsoluteUri(r.file_uri)));
}

// 録音終了後、複数セグメントを1本のWAVへ結合した結果で置き換える。
// 元のセグメント行はすべて削除し、結合後の1件だけを登録する(offset_msは常に0)
export async function replaceWithMergedFile(
  sessionId: string,
  merged: { id: string; fileUri: string; durationMs: number }
): Promise<void> {
  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync('DELETE FROM audio_files WHERE session_id = ?;', [sessionId]);
    await db.runAsync(
      `INSERT INTO audio_files (id, session_id, file_uri, seq, offset_ms, duration_ms)
       VALUES (?, ?, ?, 0, 0, ?);`,
      [merged.id, sessionId, toStorableUri(merged.fileUri), merged.durationMs]
    );
  });
}
