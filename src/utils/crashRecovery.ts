import { Alert } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';

import * as sessionsRepo from '../db/repositories/sessions';
import * as blocksRepo from '../db/repositories/blocks';
import * as audioFilesRepo from '../db/repositories/audioFiles';
import type { Session } from '../db/types';
import { deleteStoredFile } from './files';
import { adoptOrphanAudioFiles, deleteOrphanAudioFiles, hasRecoverableAudio } from './audioRecovery';
import type { RootStackParamList } from '../navigation/RootNavigator';

function formatStartedAt(unixMs: number): string {
  const d = new Date(unixMs);
  const y = d.getFullYear();
  const m = d.getMonth() + 1;
  const day = d.getDate();
  const hh = String(d.getHours()).padStart(2, '0');
  const mm = String(d.getMinutes()).padStart(2, '0');
  return `${y}/${m}/${day} ${hh}:${mm}`;
}

async function discardCrashedSession(session: Session): Promise<void> {
  const [blocks, audioFiles] = await Promise.all([
    blocksRepo.listBySessionId(session.id),
    audioFilesRepo.listBySessionId(session.id),
  ]);
  await deleteOrphanAudioFiles(session); // DB未登録のまま残っているファイルもここで削除する

  await sessionsRepo.deleteById(session.id);

  await Promise.all([
    ...blocks.filter((b) => b.kind === 'photo' && b.photoUri).map((b) => deleteStoredFile(b.photoUri as string)),
    ...audioFiles.map((f) => deleteStoredFile(f.fileUri)),
  ]);
}

// blocksが1件も無く、音声(登録済み・孤児ファイルとも)も一切無い、中身が完全に空の
// セッションかどうか。この場合はユーザーに確認するまでもないため、ダイアログなしで
// 黙って削除する対象になる
async function isSessionEmpty(session: Session): Promise<boolean> {
  const blocks = await blocksRepo.listBySessionId(session.id);
  if (blocks.length > 0) return false;
  const hasAudio = await hasRecoverableAudio(session);
  return !hasAudio;
}

function confirmDiscard(session: Session, onDone: () => void): void {
  Alert.alert(
    'このセッションを破棄しますか?',
    '録音・メモなど記録されている内容がすべて削除され、元に戻せません。',
    [
      { text: 'キャンセル', style: 'cancel', onPress: onDone },
      {
        text: '破棄する',
        style: 'destructive',
        onPress: async () => {
          await discardCrashedSession(session);
          onDone();
        },
      },
    ],
    { cancelable: false }
  );
}

// 「内容を見るだけ」は画面遷移後にNoteDetailScreenを操作させたいだけで、RecordScreenの
// ようにその場で取り込み完了を待つ理由が無いため、完全にバックグラウンドで実行する
function adoptOrphanAudioFilesInBackground(session: Session): void {
  adoptOrphanAudioFiles(session).catch((e) =>
    console.warn('[FS] 孤児音声ファイルのバックグラウンド取り込みに失敗しました', e)
  );
}

// 孤児音声ファイルの実尺取得(壊れたファイルだと最大10秒ほどかかりうる)を画面遷移の前で
// 待ってしまうと、その間ダイアログを閉じただけで何も起きないように見えてしまう。
// そのため遷移は即座に行い、実際の取り込み(RecordScreen側のresumeExisting内)や、
// 音声の有無が確定するまでの間は後回しにする
async function handleResume(
  session: Session,
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>
): Promise<void> {
  navigationRef.navigate('MainTabs', {
    screen: 'Record',
    params: { resumeSessionId: session.id },
  });
}

async function handleViewOnly(
  session: Session,
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>
): Promise<void> {
  // 実尺取得はせず、ファイルの存在有無だけを一瞬で確認してから遷移する
  const hasAudio = await hasRecoverableAudio(session);
  navigationRef.navigate('NoteDetail', {
    noteId: session.id,
    audioNotice: hasAudio ? undefined : 'missing',
  });
  adoptOrphanAudioFilesInBackground(session);
}

function promptForSession(
  session: Session,
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>,
  onDone: () => void
): void {
  const title = session.title.trim() || '(無題のノート)';
  Alert.alert(
    '前回の録音が途中で終了しています',
    `${title}\n開始日時: ${formatStartedAt(session.startedAt)}`,
    [
      {
        text: '録音を再開する',
        onPress: async () => {
          await handleResume(session, navigationRef);
          onDone();
        },
      },
      {
        text: '内容を見るだけ',
        onPress: async () => {
          await handleViewOnly(session, navigationRef);
          onDone();
        },
      },
      {
        text: '破棄する',
        style: 'destructive',
        onPress: () => confirmDiscard(session, onDone),
      },
    ],
    { cancelable: false }
  );
}

// アプリ起動直後に1回だけ呼ぶ。異常終了したセッションが複数あれば、古い順に1件ずつダイアログを出す
export async function runCrashRecoveryCheck(
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>
): Promise<void> {
  const crashedSessions = await sessionsRepo.listCrashed();
  for (const session of crashedSessions) {
    if (await isSessionEmpty(session).catch(() => false)) {
      // 判定に失敗した場合は安全側(ダイアログを出す)に倒し、確実に空だと分かった時だけ黙って消す
      await sessionsRepo.deleteById(session.id).catch((e) =>
        console.warn('[DB] 空のクラッシュセッションの削除に失敗しました', e)
      );
      continue;
    }
    await new Promise<void>((resolve) => promptForSession(session, navigationRef, resolve));
  }
}
