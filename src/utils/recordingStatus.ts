// RecordScreenが「収録中(一時停止していない)」かどうかを、他の画面(設定画面など)から
// 同期的に参照するための軽量な共有state。録音のON/OFFはRecordScreen側でしか分からないため、
// そこから都度更新する。DBやsettings.jsonへの永続化は行わない、実行中だけのランタイムstate
let isRecordingActive = false;

export function getIsRecordingActive(): boolean {
  return isRecordingActive;
}

export function setIsRecordingActive(active: boolean): void {
  isRecordingActive = active;
}
