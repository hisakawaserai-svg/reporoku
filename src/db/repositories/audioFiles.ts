import { getDb } from '../index';
import type { AudioFile } from '../types';

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
    fileUri: row.file_uri,
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
  await db.runAsync(
    `INSERT INTO audio_files (id, session_id, file_uri, seq, offset_ms, duration_ms)
     VALUES (?, ?, ?, ?, ?, ?);`,
    [input.id, input.sessionId, input.fileUri, input.seq, input.offsetMs, input.durationMs]
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
