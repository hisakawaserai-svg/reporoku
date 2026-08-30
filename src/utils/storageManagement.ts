import { File } from "expo-file-system";
import * as sessionsRepo from "../db/repositories/sessions";
import * as blocksRepo from "../db/repositories/blocks";
import * as audioFilesRepo from "../db/repositories/audioFiles";
import type { Session } from "../db/types";
import { deleteStoredFile, listAudioDirectoryEntries, listPhotosDirectoryEntries } from "./files";

function fileSize(uri: string): number {
  try {
    return new File(uri).size ?? 0;
  } catch {
    return 0;
  }
}

export interface NoteStorageEntry {
  sessionId: string;
  title: string;
  startedAt: number;
  bytes: number;
  hasAudio: boolean;
}

// 設定画面のストレージ管理用に、ノートごとの使用容量(音声+写真)を大きい順に一覧化する
export async function listNoteStorageEntries(): Promise<NoteStorageEntry[]> {
  const sessions: Session[] = await sessionsRepo.listAll();
  const entries = await Promise.all(
    sessions.map(async (session): Promise<NoteStorageEntry> => {
      const [blocks, audioFiles] = await Promise.all([
        blocksRepo.listBySessionId(session.id),
        audioFilesRepo.listBySessionId(session.id),
      ]);
      const photoBytes = blocks
        .filter((b) => b.kind === "photo" && b.photoUri)
        .reduce((sum, b) => sum + fileSize(b.photoUri as string), 0);
      const audioBytes = audioFiles.reduce((sum, f) => sum + fileSize(f.fileUri), 0);
      return {
        sessionId: session.id,
        title: session.title,
        startedAt: session.startedAt,
        bytes: photoBytes + audioBytes,
        hasAudio: audioFiles.length > 0,
      };
    })
  );
  // 音声・写真とも無いノート(0byte)は削除対象にならないため一覧に出す意味が無く、除外する
  return entries.filter((e) => e.bytes > 0).sort((a, b) => b.bytes - a.bytes);
}

export function totalBytesOf(entries: NoteStorageEntry[]): number {
  return entries.reduce((sum, e) => sum + e.bytes, 0);
}

// 指定ノートの音声のみ削除する(blocksのテキスト記録は残す)
export async function deleteSessionAudio(sessionId: string): Promise<void> {
  const audioFiles = await audioFilesRepo.listBySessionId(sessionId);
  await audioFilesRepo.deleteBySessionId(sessionId);
  await Promise.all(audioFiles.map((f) => deleteStoredFile(f.fileUri)));
}

// 全ノートの音声を一括削除する(blocksのテキスト記録は残す)
export async function deleteAllAudio(): Promise<void> {
  const audioFiles = await audioFilesRepo.listAll();
  await audioFilesRepo.deleteAll();
  await Promise.all(audioFiles.map((f) => deleteStoredFile(f.fileUri)));
}

// 録音中は、セグメントファイルがディスクに書き込まれてから「audioend」イベントで
// audio_filesへ登録されるまでにタイムラグがある。通常は数十秒〜数分で登録されるが、
// 録音状態そのものを見ているわけではない(音声認識ロジックには踏み込まない)ため、
// 万一登録が長時間滞留した場合でも誤って録音中のファイルを消さないよう、
// 掃除を急ぐ理由が無いことを踏まえて十分大きな安全マージンを取る
const ORPHAN_MIN_AGE_MS = 24 * 60 * 60 * 1000;

export interface OrphanFilesSummary {
  audioUris: string[];
  photoUris: string[];
  bytes: number;
}

// audio_files/blocksのどちらからも参照されていない実ファイル(削除処理の失敗や、
// 孤児音声の取り込み失敗などで残ったもの)を検出する
export async function findOrphanFiles(): Promise<OrphanFilesSummary> {
  const now = Date.now();
  const [audioEntries, registeredAudioUris, photoEntries, registeredPhotoUris] = await Promise.all([
    Promise.resolve(listAudioDirectoryEntries()),
    audioFilesRepo.listAllFileUris(),
    Promise.resolve(listPhotosDirectoryEntries()),
    blocksRepo.listAllPhotoUris(),
  ]);
  const registeredPhotoSet = new Set(registeredPhotoUris);

  const audioUris = audioEntries
    .filter((e) => !registeredAudioUris.has(e.uri))
    .filter((e) => now - e.lastModified >= ORPHAN_MIN_AGE_MS)
    .map((e) => e.uri);
  const photoUris = photoEntries
    .filter((e) => !registeredPhotoSet.has(e.uri))
    .filter((e) => now - e.lastModified >= ORPHAN_MIN_AGE_MS)
    .map((e) => e.uri);

  const bytes = [...audioUris, ...photoUris].reduce((sum, uri) => sum + fileSize(uri), 0);
  return { audioUris, photoUris, bytes };
}

export async function deleteOrphanFiles(summary: OrphanFilesSummary): Promise<void> {
  await Promise.all([...summary.audioUris, ...summary.photoUris].map((uri) => deleteStoredFile(uri)));
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 KB";
  const units = ["B", "KB", "MB", "GB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex++;
  }
  const decimals = unitIndex === 0 ? 0 : value < 10 ? 1 : 0;
  return `${value.toFixed(decimals)} ${units[unitIndex]}`;
}
