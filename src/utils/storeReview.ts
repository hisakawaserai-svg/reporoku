import * as StoreReview from "expo-store-review";

import { noteCompletedRecording } from "./settings";

/**
 * 空でない収録を終えたあと(完了画面)から呼ぶ。
 * 3回目、10回目、その後は50回ごと。ボタンからは呼ばない(Apple の HIG)。
 * TestFlight 配布では OS がシートを出さない。
 */
export function shouldRequestStoreReview(completedCount: number): boolean {
  if (completedCount === 3 || completedCount === 10) return true;
  return completedCount >= 50 && completedCount % 50 === 0;
}

export async function maybeRequestStoreReviewAfterRecording(sessionId: string): Promise<void> {
  const count = noteCompletedRecording(sessionId);
  if (!shouldRequestStoreReview(count)) return;
  try {
    if (!(await StoreReview.isAvailableAsync())) return;
    if (!(await StoreReview.hasAction())) return;
    await StoreReview.requestReview();
  } catch (e) {
    console.warn("[StoreReview] requestReview failed", e);
  }
}
