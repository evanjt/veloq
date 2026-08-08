/**
 * Ask Rust to refresh the trailing wellness window.
 *
 * Returns instantly: the fetch runs on the Rust runtime and the resulting
 * SQLite write is announced on the engine's `wellness` channel, which is what
 * actually re-renders the fitness charts, the summary card and the widget.
 * Callers fire and forget.
 */
import { useAuthStore } from '@/shared/app/AuthStore';

import { getRouteEngine } from './routeEngine';

/** Only the last fortnight can have changed in a way the screens show, and the
 *  upsert is keyed on date, so this merges into the year the full sync stored. */
export const WELLNESS_REFRESH_DAYS = 14;

/**
 * Refresh and wait for the write to land. Only for callers that read the rows
 * immediately afterwards, like the background notification task, where firing
 * and forgetting would compose the notification from pre-activity numbers.
 * Resolves false if the sync never started or did not settle in time.
 */
export async function refreshWellnessAndWait(timeoutMs = 15_000): Promise<boolean> {
  if (!refreshWellness()) return false;
  const engine = getRouteEngine();
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    const state = engine?.getSyncStatus?.()?.state;
    if (state !== 'syncing') return true;
  }
  return false;
}

export function refreshWellness(days: number = WELLNESS_REFRESH_DAYS): boolean {
  const { isAuthenticated, isDemoMode } = useAuthStore.getState();
  // Demo holds no credential and reads the rows seedDemoEngine wrote.
  if (!isAuthenticated || isDemoMode) return false;

  const engine = getRouteEngine();
  if (!engine?.syncWellnessNow) return false;
  try {
    return engine.syncWellnessNow(days);
  } catch {
    return false;
  }
}
