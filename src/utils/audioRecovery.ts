import { createAudioPlayer } from 'expo-audio';

import * as sessionsRepo from '../db/repositories/sessions';
import * as audioFilesRepo from '../db/repositories/audioFiles';
import type { Session } from '../db/types';
import { deleteStoredFile, listAudioDirectoryEntries } from './files';
import { genId } from './id';

// 強制終了(audioendが発火しないケース)で、ディスクには書き込まれているのに
// audio_filesテーブルに登録されないまま残ったファイルを「孤児ファイル」と呼ぶ。
// mtimeが「対象セッションの開始時刻」〜「次に新しいセッションの開始時刻(無ければ無制限)」に
// 収まるものだけを、そのセッションのものと推測する
async function findOrphanAudioFiles(
  session: Session
): Promise<{ uri: string; lastModified: number }[]> {
  const [entries, registeredUris, allSessions] = await Promise.all([
    Promise.resolve(listAudioDirectoryEntries()),
    audioFilesRepo.listAllFileUris(),
    sessionsRepo.listAll(),
  ]);

  const nextStartedAt = allSessions
    .map((s) => s.startedAt)
    .filter((startedAt) => startedAt > session.startedAt)
    .reduce((min, startedAt) => Math.min(min, startedAt), Infinity);

  return entries
    .filter((e) => !registeredUris.has(e.uri))
    .filter((e) => e.lastModified >= session.startedAt && e.lastModified < nextStartedAt)
    .sort((a, b) => a.lastModified - b.lastModified);
}

// 「タップした位置から正確に再生する」ため、ファイル名やmtimeからの概算ではなく、
// 実際に音声ファイルを一度ロードして正確な長さを取得する
async function getAudioDurationMs(fileUri: string): Promise<number> {
  const player = createAudioPlayer({ uri: fileUri });
  try {
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        sub.remove();
        reject(new Error('音声の長さ取得がタイムアウトしました'));
      }, 10000);
      const sub = player.addListener('playbackStatusUpdate', (status) => {
        if (status.isLoaded && status.duration > 0) {
          clearTimeout(timeout);
          sub.remove();
          resolve();
        }
      });
    });
    return Math.round(player.duration * 1000);
  } finally {
    player.remove();
  }
}

export interface AdoptOrphanAudioResult {
  adoptedCount: number;
  hasAnyAudio: boolean;
}

// 「復元する」「録音を再開する」「内容を見るだけ」の全ての分岐で、対象セッションを
// 使う前に必ず1回呼ぶ。孤児ファイルをaudio_filesへ登録し、既存の音声ファイルと合わせて
// 「このセッションに音声が1件でもあるか」を返す
export async function adoptOrphanAudioFiles(session: Session): Promise<AdoptOrphanAudioResult> {
  const [existing, orphans] = await Promise.all([
    audioFilesRepo.listBySessionId(session.id),
    findOrphanAudioFiles(session),
  ]);

  let seq = existing.reduce((max, f) => Math.max(max, f.seq), -1) + 1;
  let offsetMs = existing.reduce((sum, f) => sum + f.durationMs, 0);
  let adoptedCount = 0;

  for (const orphan of orphans) {
    try {
      const durationMs = await getAudioDurationMs(orphan.uri);
      await audioFilesRepo.create({
        id: genId(),
        sessionId: session.id,
        fileUri: orphan.uri,
        seq,
        offsetMs,
        durationMs,
      });
      seq += 1;
      offsetMs += durationMs;
      adoptedCount += 1;
    } catch (e) {
      console.warn('[FS] 孤児音声ファイルの取り込みに失敗しました', orphan.uri, e);
    }
  }

  return { adoptedCount, hasAnyAudio: existing.length + adoptedCount > 0 };
}

// セッションを破棄する場合は、登録するだけ無駄なので、対象の孤児ファイルをディスクから
// 直接削除する(audio_filesへの登録は行わない)
export async function deleteOrphanAudioFiles(session: Session): Promise<void> {
  const orphans = await findOrphanAudioFiles(session);
  await Promise.all(orphans.map((orphan) => deleteStoredFile(orphan.uri)));
}
