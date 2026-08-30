import * as sessionsRepo from '../db/repositories/sessions';
import * as audioFilesRepo from '../db/repositories/audioFiles';
import type { Session } from '../db/types';
import { deleteStoredFile, listAudioDirectoryEntries } from './files';
import { genId } from './id';
import { computeWavDurationMs } from './wavFile';

// 強制終了(audioendが発火しないケース)で、ディスクには書き込まれているのに
// audio_filesテーブルに登録されないまま残ったファイルを「孤児ファイル」と呼ぶ。
// mtimeが「対象セッションの開始時刻」〜「次に新しいセッションの開始時刻(無ければ無制限)」に
// 収まるものだけを、そのセッションのものと推測する
export async function findOrphanAudioFiles(
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

// 実尺の取得(音声ファイルの実読み込み)を伴わない、軽い事前チェック。ディスクの一覧取得と
// DBクエリだけなので一瞬で終わる。「復元する/内容を見るだけ」を選んだ直後にこれだけで
// 音声の有無を確定させ、遷移そのものが壊れたファイルのせいで固まらないようにする
export async function hasRecoverableAudio(session: Session): Promise<boolean> {
  const [existing, orphans] = await Promise.all([
    audioFilesRepo.listBySessionId(session.id),
    findOrphanAudioFiles(session),
  ]);
  return existing.length > 0 || orphans.length > 0;
}

export interface AdoptOrphanAudioResult {
  adoptedCount: number;
  hasAnyAudio: boolean;
}

// 「復元する」「録音を再開する」「内容を見るだけ」の全ての分岐で、対象セッションを
// 使う前に必ず1回呼ぶ。孤児ファイルをaudio_filesへ登録し、既存の音声ファイルと合わせて
// 「このセッションに音声が1件でもあるか」を返す。
//
// 実尺の取得は、以前はexpo-audioでファイルを実際にロードし、再生準備が整うのを
// (タイムアウト付きで)待つ方式だったが、これは正常なファイルでも数秒〜タイムアウトまで
// 待たされることがあり(実機・シミュレータともに確認)、しかも失敗した孤児ファイルは
// audio_filesに登録されないままになるため、後から登録される別セグメントとの間で
// offset_msの対応関係が崩れ、「どのブロックをタップしても違う位置が再生される」不具合の
// 原因になっていた。WAVヘッダのdataチャンクから直接durationを計算する方式(wavFile.ts)に
// 変更し、ファイルの実読み込み・タイムアウト待ちを無くすことで、この問題を解消した
export async function adoptOrphanAudioFiles(session: Session): Promise<AdoptOrphanAudioResult> {
  const [existing, orphans] = await Promise.all([
    audioFilesRepo.listBySessionId(session.id),
    findOrphanAudioFiles(session),
  ]);

  let seq = existing.reduce((max, f) => Math.max(max, f.seq), -1) + 1;
  let offsetMs = existing.reduce((sum, f) => sum + f.durationMs, 0);
  let adoptedCount = 0;

  for (const orphan of orphans) {
    const durationMs = computeWavDurationMs(orphan.uri);
    if (durationMs === null || durationMs <= 0) {
      console.warn('[FS] 孤児音声ファイルのヘッダを解析できませんでした', orphan.uri);
      continue;
    }
    try {
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
      console.warn('[DB] 孤児音声ファイルの登録に失敗しました', orphan.uri, e);
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
