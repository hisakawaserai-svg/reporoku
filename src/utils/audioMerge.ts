import { File, FileMode, type FileHandle } from 'expo-file-system';

import * as audioFilesRepo from '../db/repositories/audioFiles';
import type { AudioFile } from '../db/types';
import { deleteStoredFile, getAudioDirectoryUri } from './files';
import { genId } from './id';

// continuousモードの自動再起動により、1回の収録は複数の音声セグメント(.wav)に分かれて
// 保存される。録音終了後、これらを1本のWAVファイルへ結合し、DB上もaudio_filesを1件に
// まとめる。実機で実際に生成されたWAVを調べたところ、iOS側は「32-bit float PCM」
// (ExtAudioFileが書き出す形式)で、fmtチャンクの後に4096byte境界へ揃えるための
// "FLLR"パディングチャンクが挟まり、その後にdataチャンクが続く非標準的な構造だったため、
// 固定オフセット(よくある44byteヘッダ決め打ち)ではなく、チャンクをたどって解析する

const HEADER_PEEK_BYTES = 8192; // fmt/dataチャンクを見つけるのに十分な先頭バイト数
const COPY_CHUNK_BYTES = 1024 * 1024; // 大きなファイルを一度にメモリへ載せないためのコピー単位

interface WavFormatInfo {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
}

interface WavHeaderInfo extends WavFormatInfo {
  dataOffset: number;
  dataSize: number;
}

function readUInt32LE(bytes: Uint8Array, offset: number): number {
  return (bytes[offset] | (bytes[offset + 1] << 8) | (bytes[offset + 2] << 16) | (bytes[offset + 3] << 24)) >>> 0;
}

function readUInt16LE(bytes: Uint8Array, offset: number): number {
  return bytes[offset] | (bytes[offset + 1] << 8);
}

function bytesToAscii(bytes: Uint8Array, start: number, length: number): string {
  let s = '';
  for (let i = 0; i < length; i++) s += String.fromCharCode(bytes[start + i]);
  return s;
}

// RIFFのサブチャンクを先頭から辿り、目的のチャンクidのバイト位置(id自体の開始位置)を探す。
// 各チャンクは "id(4) + size(4) + payload(size, 奇数なら1byteパディング)" の並び
function findChunkOffset(bytes: Uint8Array, id: string): number | null {
  let offset = 12; // "RIFF"+size(4)+"WAVE" の直後から
  while (offset + 8 <= bytes.length) {
    const chunkId = bytesToAscii(bytes, offset, 4);
    const size = readUInt32LE(bytes, offset + 4);
    if (chunkId === id) return offset;
    offset += 8 + size + (size % 2);
  }
  return null;
}

function parseWavHeader(headerBytes: Uint8Array): WavHeaderInfo | null {
  if (headerBytes.length < 12) return null;
  if (bytesToAscii(headerBytes, 0, 4) !== 'RIFF' || bytesToAscii(headerBytes, 8, 4) !== 'WAVE') return null;

  const fmtOffset = findChunkOffset(headerBytes, 'fmt ');
  if (fmtOffset === null) return null;
  const fmtStart = fmtOffset + 8;
  const audioFormat = readUInt16LE(headerBytes, fmtStart);
  const numChannels = readUInt16LE(headerBytes, fmtStart + 2);
  const sampleRate = readUInt32LE(headerBytes, fmtStart + 4);
  const blockAlign = readUInt16LE(headerBytes, fmtStart + 12);
  const bitsPerSample = readUInt16LE(headerBytes, fmtStart + 14);

  const dataOffset = findChunkOffset(headerBytes, 'data');
  if (dataOffset === null) return null;
  const dataSize = readUInt32LE(headerBytes, dataOffset + 4);

  return {
    audioFormat,
    numChannels,
    sampleRate,
    bitsPerSample,
    blockAlign,
    dataOffset: dataOffset + 8,
    dataSize,
  };
}

function sameFormat(a: WavFormatInfo, b: WavFormatInfo): boolean {
  return (
    a.audioFormat === b.audioFormat &&
    a.numChannels === b.numChannels &&
    a.sampleRate === b.sampleRate &&
    a.bitsPerSample === b.bitsPerSample &&
    a.blockAlign === b.blockAlign
  );
}

// 結合後の出力ファイルは、余計なパディングチャンクを持たない標準的な44byteヘッダで書き出す
// (読み込み側は既にこの形式で問題なく解析できている)
function buildCanonicalWavHeader(format: WavFormatInfo, dataSize: number): Uint8Array {
  const header = new Uint8Array(44);
  const view = new DataView(header.buffer);
  const writeAscii = (offset: number, s: string) => {
    for (let i = 0; i < s.length; i++) header[offset + i] = s.charCodeAt(i);
  };
  writeAscii(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(8, 'WAVE');
  writeAscii(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, format.audioFormat, true);
  view.setUint16(22, format.numChannels, true);
  view.setUint32(24, format.sampleRate, true);
  const byteRate = format.sampleRate * format.blockAlign;
  view.setUint32(28, byteRate, true);
  view.setUint16(32, format.blockAlign, true);
  view.setUint16(34, format.bitsPerSample, true);
  writeAscii(36, 'data');
  view.setUint32(40, dataSize, true);
  return header;
}

function alignDownToBlock(byteLength: number, blockAlign: number): number {
  return byteLength - (byteLength % blockAlign);
}

export interface MergeAudioResult {
  fileUri: string;
  durationMs: number;
}

// segmentsは同一セッションのaudio_files(offsetMs昇順)。セグメント間に隙間があれば
// (offsetMsが前セグメントの終端と一致しない場合)、その分だけ無音(全0バイト)を挿入し、
// blocksのstartMs等が指すタイムラインとの対応関係を崩さないようにする。
// フォーマットが1件でも一致しない・ファイルが読めない等があれば、何もせずnullを返す
// (呼び出し側は元のセグメントをそのまま残す)
export async function mergeAudioSegments(segments: AudioFile[]): Promise<MergeAudioResult | null> {
  if (segments.length === 0) return null;
  const sorted = [...segments].sort((a, b) => a.offsetMs - b.offsetMs);

  const parsed: { seg: AudioFile; info: WavHeaderInfo }[] = [];
  for (const seg of sorted) {
    const srcFile = new File(seg.fileUri);
    if (!srcFile.exists) return null;
    const handle = srcFile.open(FileMode.ReadOnly);
    try {
      const peekLen = Math.min(HEADER_PEEK_BYTES, handle.size ?? HEADER_PEEK_BYTES);
      handle.offset = 0;
      const info = parseWavHeader(handle.readBytes(peekLen));
      if (!info) return null;
      parsed.push({ seg, info });
    } finally {
      handle.close();
    }
  }

  const baseFormat = parsed[0].info;
  if (!parsed.every(({ info }) => sameFormat(info, baseFormat))) {
    console.warn('[audioMerge] セグメント間で音声フォーマットが一致しないため結合を中止しました');
    return null;
  }
  const byteRate = baseFormat.sampleRate * baseFormat.blockAlign;

  const outFile = new File(getAudioDirectoryUri(), `merged_${genId()}.wav`);
  if (outFile.exists) outFile.delete();
  outFile.create();
  const outHandle = outFile.open(FileMode.ReadWrite);

  let totalDataBytes = 0;
  try {
    // ヘッダ(44byte)は最後に正しいdata sizeで書き直すため、まず本体分だけ先に書く
    outHandle.offset = 44;

    let prevSegmentEndMs = sorted[0].offsetMs; // 先頭セグメントの手前には無音を入れない
    for (const { seg, info } of parsed) {
      const gapMs = Math.max(0, seg.offsetMs - prevSegmentEndMs);
      if (gapMs > 0) {
        const silenceBytes = alignDownToBlock(Math.round((gapMs / 1000) * byteRate), baseFormat.blockAlign);
        totalDataBytes += writeSilence(outHandle, silenceBytes);
      }

      const srcFile = new File(seg.fileUri);
      const srcHandle = srcFile.open(FileMode.ReadOnly);
      try {
        srcHandle.offset = info.dataOffset;
        let remaining = info.dataSize;
        while (remaining > 0) {
          const chunkLen = Math.min(COPY_CHUNK_BYTES, remaining);
          const chunk = srcHandle.readBytes(chunkLen);
          if (chunk.length === 0) break; // 想定外にファイルが短い場合の保険
          outHandle.writeBytes(chunk);
          totalDataBytes += chunk.length;
          remaining -= chunk.length;
        }
      } finally {
        srcHandle.close();
      }

      prevSegmentEndMs = seg.offsetMs + seg.durationMs;
    }

    outHandle.offset = 0;
    outHandle.writeBytes(buildCanonicalWavHeader(baseFormat, totalDataBytes));
  } finally {
    outHandle.close();
  }

  const durationMs = Math.round((totalDataBytes / byteRate) * 1000);
  return { fileUri: outFile.uri, durationMs };
}

function writeSilence(handle: FileHandle, byteLength: number): number {
  if (byteLength <= 0) return 0;
  const CHUNK = 65536;
  const zeros = new Uint8Array(Math.min(CHUNK, byteLength));
  let remaining = byteLength;
  while (remaining > 0) {
    const len = Math.min(CHUNK, remaining);
    handle.writeBytes(len === zeros.length ? zeros : zeros.slice(0, len));
    remaining -= len;
  }
  return byteLength;
}

// セッション終了時に呼ぶ。2件以上のセグメントがある場合だけ結合し、成功したら
// 元のセグメント行・ファイルを削除する。失敗しても例外は投げず、元のまま何もしない
export async function mergeSessionAudioSegments(sessionId: string): Promise<void> {
  const segments = await audioFilesRepo.listBySessionId(sessionId);
  if (segments.length < 2) return; // 1件以下なら結合の意味が無い

  const result = await mergeAudioSegments(segments);
  if (!result) return;

  await audioFilesRepo.replaceWithMergedFile(sessionId, {
    id: genId(),
    fileUri: result.fileUri,
    durationMs: result.durationMs,
  });

  await Promise.all(segments.map((seg) => deleteStoredFile(seg.fileUri)));
}
