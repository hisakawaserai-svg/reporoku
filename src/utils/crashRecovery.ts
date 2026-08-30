import { Alert } from 'react-native';
import type { NavigationContainerRefWithCurrent } from '@react-navigation/native';

import * as sessionsRepo from '../db/repositories/sessions';
import * as blocksRepo from '../db/repositories/blocks';
import * as audioFilesRepo from '../db/repositories/audioFiles';
import type { Session } from '../db/types';
import { deleteStoredFile } from './files';
import { adoptOrphanAudioFiles, deleteOrphanAudioFiles } from './audioRecovery';
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

async function handleResume(
  session: Session,
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>
): Promise<void> {
  await adoptOrphanAudioFiles(session); // 録音再開前に、取り込める音声ファイルは先に登録しておく
  navigationRef.navigate('MainTabs', {
    screen: 'Record',
    params: { resumeSessionId: session.id },
  });
}

async function handleViewOnly(
  session: Session,
  navigationRef: NavigationContainerRefWithCurrent<RootStackParamList>
): Promise<void> {
  const { hasAnyAudio } = await adoptOrphanAudioFiles(session);
  navigationRef.navigate('NoteDetail', {
    noteId: session.id,
    audioNotice: hasAnyAudio ? undefined : 'missing',
  });
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
    await new Promise<void>((resolve) => promptForSession(session, navigationRef, resolve));
  }
}
