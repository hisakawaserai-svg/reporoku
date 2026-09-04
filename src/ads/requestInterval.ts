/** AdMob 推奨の最短リクエスト間隔（マウントし直し対策）。 */
export const MIN_AD_REQUEST_INTERVAL_MS = 60_000;

let lastRequestedAt: number | null = null;

export function markAdRequested(now: number = Date.now()): void {
  lastRequestedAt = now;
}

export function adRequestCooldown(now: number = Date.now()): number {
  if (lastRequestedAt == null) return 0;
  const elapsed = now - lastRequestedAt;
  if (elapsed < 0) return 0;
  return Math.max(0, MIN_AD_REQUEST_INTERVAL_MS - elapsed);
}
