/**
 * 収録タブ表示中は他タブのバナー／MRECを止めるためのゲート。
 * RecordScreen のフォーカスで更新する（実際の録音中フラグとは別）。
 */
import { useSyncExternalStore } from "react";

let recordScreenFocused = false;
const listeners = new Set<() => void>();

function publish(next: boolean) {
  if (recordScreenFocused === next) return;
  recordScreenFocused = next;
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function setRecordScreenFocused(focused: boolean): void {
  publish(focused);
}

export function getRecordScreenFocused(): boolean {
  return recordScreenFocused;
}

export function useRecordScreenFocused(): boolean {
  return useSyncExternalStore(subscribe, getRecordScreenFocused);
}
