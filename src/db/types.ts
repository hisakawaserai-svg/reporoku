export type BlockKind = 'transcript' | 'note' | 'photo';
export type QuestionKind = 'question' | 'term';

export interface Session {
  id: string;
  title: string;
  startedAt: number;
  durationMs: number;
  createdAt: number;
  updatedAt: number;
  sectionGapMs: number;
  // セクション内で同じ段落として詰めるかの閾値(ms)。常にsectionGapMsより小さい値
  paragraphGapMs: number;
  isQuick: boolean;
  isPinned: boolean;
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
  // 発話終了の実測値(録音時にtranscriptのみ記録)。nullの場合はセクション分けの
  // 間隔計算で文字数からの推定にフォールバックする(古いデータやnote/photoなど)
  endMs: number | null;
  text: string | null;
  photoUri: string | null;
  isStarred: boolean;
  isTodo: boolean;
  todoDone: boolean;
  isQuestion: boolean;
  questionTerm: string | null;
  questionKind: QuestionKind | null;
  isEdited: boolean;
  createdAt: number;
  summaryNote: string | null;
  isDeferred: boolean;
  importantGroup: string | null;
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
