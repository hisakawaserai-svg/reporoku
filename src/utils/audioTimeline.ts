import type { AudioFile } from "../db/types";

export interface AudioPosition {
  file: AudioFile;
  positionMs: number;
}

// targetMs(セッション全体での時刻)が、audioFiles のどのファイルの
// 何ミリ秒地点にあたるかを求める。
// offsetMs <= targetMs < offsetMs + durationMs の範囲で探し、
// 範囲外(ファイル間の隙間・末尾より後・先頭より前)の場合は
// 直前のファイルの範囲内にクランプする。
export function resolveAudioPosition(
  targetMs: number,
  audioFiles: AudioFile[]
): AudioPosition | null {
  if (audioFiles.length === 0) return null;

  const sorted = [...audioFiles].sort((a, b) => a.offsetMs - b.offsetMs);

  let candidate = sorted[0];
  for (const file of sorted) {
    if (file.offsetMs <= targetMs) {
      candidate = file;
    } else {
      break;
    }
  }

  const positionMs = Math.min(Math.max(targetMs - candidate.offsetMs, 0), candidate.durationMs);
  return { file: candidate, positionMs };
}
