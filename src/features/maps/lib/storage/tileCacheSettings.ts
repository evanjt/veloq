/**
 * One-off migration of the persisted tile cache settings.
 *
 * Tiles are cached passively as the user browses, through the Cache API inside
 * the map WebViews, so nothing reads these settings at runtime any more. The
 * key is kept because the backup format still carries it, and an older install
 * can still hold a proactive cache mode that has to be flattened to ambient.
 */

import { getSetting, setSetting } from '@/shared/storage';

const STORAGE_KEY = 'veloq-tile-cache';

export async function migrateTileCacheSettings(): Promise<void> {
  try {
    const stored = await getSetting(STORAGE_KEY);
    if (!stored) return;
    const raw = JSON.parse(stored) as Record<string, unknown>;
    if (raw.cacheMode && raw.cacheMode !== 'ambient') {
      await setSetting(STORAGE_KEY, JSON.stringify({ cacheMode: 'ambient' }));
    }
  } catch {
    // A corrupt or unreadable value is left alone: startup must not fail on it.
  }
}
