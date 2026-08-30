import { File, FileMode } from 'expo-file-system';

// 実機で実際に生成されたWAVを調べたところ、iOS側は「32-bit float PCM」
// (ExtAudioFileが書き出す形式)で、fmtチャンクの後に4096byte境界へ揃えるための
// "FLLR"パディングチャンクが挟まり、その後にdataチャンクが続く非標準的な構造だったため、
// 固定オフセット(よくある44byteヘッダ決め打ち)ではなく、チャンクをたどって解析する。
// audioMerge.ts(結合)とaudioRecovery.ts(孤児ファイルの実尺取得)の両方で使う共通処理

const HEADER_PEEK_BYTES = 8192; // fmt/dataチャンクを見つけるのに十分な先頭バイト数

export interface WavFormatInfo {
  audioFormat: number;
  numChannels: number;
  sampleRate: number;
  bitsPerSample: number;
  blockAlign: number;
}

export interface WavHeaderInfo extends WavFormatInfo {
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

export function parseWavHeader(headerBytes: Uint8Array): WavHeaderInfo | null {
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

export function sameWavFormat(a: WavFormatInfo, b: WavFormatInfo): boolean {
  return (
    a.audioFormat === b.audioFormat &&
    a.numChannels === b.numChannels &&
    a.sampleRate === b.sampleRate &&
    a.bitsPerSample === b.bitsPerSample &&
    a.blockAlign === b.blockAlign
  );
}

// ファイルの先頭だけを読み、WAVヘッダを解析する(ファイル全体は読まない)
export function readWavHeader(fileUri: string): WavHeaderInfo | null {
  const file = new File(fileUri);
  if (!file.exists) return null;
  const handle = file.open(FileMode.ReadOnly);
  try {
    const peekLen = Math.min(HEADER_PEEK_BYTES, handle.size ?? HEADER_PEEK_BYTES);
    handle.offset = 0;
    return parseWavHeader(handle.readBytes(peekLen));
  } finally {
    handle.close();
  }
}

// ヘッダのdataチャンク宣言サイズと実際のファイルサイズを突き合わせ、より信頼できる方
// (強制終了などで書き込みが完了しておらず、宣言サイズが実ファイルサイズを超えている場合は
// 実ファイルサイズを採用する)を返す。durationの算出(computeWavDurationMs)と、
// 結合時に実際にコピーするバイト数(audioMerge.ts)の両方で、必ずこの値を使うこと。
// 別々の判定基準を使うと、両者の結果が食い違う(結合後の長さがdurationMsと合わなくなる)
export function effectiveDataSize(header: WavHeaderInfo, actualFileSize: number): number {
  const actualDataBytes = Math.max(0, actualFileSize - header.dataOffset);
  return header.dataSize > 0 && header.dataOffset + header.dataSize <= actualFileSize
    ? header.dataSize
    : actualDataBytes;
}

// ファイルの実読み込み・再生やタイムアウト待ちが一切不要なため、
// expo-audioでの実尺取得より速く確実にdurationMsを算出する
export function computeWavDurationMs(fileUri: string): number | null {
  const file = new File(fileUri);
  if (!file.exists) return null;
  const header = readWavHeader(fileUri);
  if (!header) return null;
  const byteRate = header.sampleRate * header.blockAlign;
  if (byteRate <= 0) return null;

  const dataBytes = effectiveDataSize(header, file.size ?? 0);
  return Math.round((dataBytes / byteRate) * 1000);
}
