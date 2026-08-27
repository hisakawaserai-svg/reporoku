export type BlockKind = 'transcript' | 'note' | 'photo';

export interface Session {
  id: string;
  title: string;
  startedAt: number;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
}

export interface AudioFile {
  id: string;
  sessionId: string;
  fileUri: string;
  seq: number;
  offsetMs: number;
  durationMs: number;
}

export interface Block {
  id: string;
  sessionId: string;
  kind: BlockKind;
  startMs: number;
  text: string | null;
  photoUri: string | null;
  isStarred: boolean;
  isTodo: boolean;
  todoDone: boolean;
  isQuestion: boolean;
  questionTerm: string | null;
  isEdited: boolean;
  createdAt: number;
}

export interface BlockWithSession extends Block {
  sessionTitle: string;
  sessionStartedAt: number;
}

export interface SearchResult extends BlockWithSession {
  snippet: string;
}

export interface MonthGroup<T> {
  monthKey: string; // 'YYYY-MM'
  items: T[];
}
