/**
 * Filesystem-based JPEG cache for 3D terrain preview images.
 *
 * Stores pre-rendered 3D terrain map snapshots as JPEG files with a hard cap
 * on the number of cached images. Uses an in-memory index for fast lookups
 * without filesystem calls.
 *
 * Cache keys are compound: `{activityId}_{style}` for the flat basemap and
 * `{activityId}_{style}_3d` for the terrain drape, so neither a style change
 * nor a 3D toggle serves the previous render.
 *
 * Storage location: documentDirectory/terrain_previews/
 *
 * ## The generation policy this cache serves
 *
 * Previews are made on demand and nowhere else. A card asks when it mounts
 * within one screen of the viewport (`previewRange.ts`), and there is exactly
 * one caller of `requestSnapshot`, the card's own effect in
 * `ActivityMapPreview.tsx`. No pass walks the library ahead of the athlete, no
 * sync schedules one, and none should be added: the reason this file has a
 * policy at all is that generating for every activity turned an on-demand
 * cache into a background job with no definition of done, which is what every
 * preview bug from that period had in common.
 *
 * "Done" is therefore per card, not per library. A card is finished when it
 * holds the render it asked for, and the feed is never finished, because it
 * never owed the whole library a picture.
 *
 * The lookahead is one screen forward and none behind. A card above the
 * viewport has already been on screen, so it either holds its preview or lost
 * it to eviction and will ask again on the way back. The list itself mounts two
 * to three screens either side so scrolling does not blank, and that window is
 * deliberately not the generation window: the queue is two workers deep and a
 * fast scroll would fill it with cards the athlete has gone past.
 *
 * Until a preview arrives the card is not blank. It draws the Skia route line
 * with its PR sections and end dots under a short skeleton, so a library that
 * has never been scrolled reads as lines rather than as loading, and the line
 * is the design rather than a placeholder for a picture that is owed.
 *
 * The cap is entries, 150 of them, and recency decides what goes. It is not a
 * byte budget: a JPEG at this height varies little, so entries track bytes
 * closely enough, and an eviction that has to weigh files is an eviction that
 * has to stat them.
 *
 * Nothing about generation is announced. There is no notification, no shade
 * entry and no progress count, because a preview being made is not something
 * the athlete can act on, and the only honest surface for it would report a
 * queue they did not ask to fill.
 */

// Use legacy API for SDK 54 compatibility
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { TERRAIN_PREVIEW_DIR } from '@/shared/storage/terrainPreviewRoot';

const TERRAIN_DIR = TERRAIN_PREVIEW_DIR;

const MAX_CACHED_PREVIEWS = 150;

/**
 * Cache version - increment whenever rendering logic changes
 * (style, hillshade, tile loading, camera, pixel ratio).
 * On mismatch, all cached snapshots are cleared so users get fresh renders.
 */
export const TERRAIN_CACHE_VERSION = 7;
/** The rendering version the cached previews on this device were drawn at. */
export const TERRAIN_PREVIEW_VERSION_KEY = 'terrain-preview-cache-version';
const VERSION_KEY = TERRAIN_PREVIEW_VERSION_KEY;

/**
 * The cached keys, least recently served first, so a launch does not have to
 * stat every file to work it out. Written whenever the index changes.
 */
const ORDER_KEY = 'terrain-preview-order';

/**
 * A serve only reorders, so its write can wait and be one write for a scroll
 * rather than one per card. Anything that changes what is in the cache still
 * writes straight away.
 */
const ORDER_WRITE_COALESCE_MS = 1000;

/**
 * What a render fell back to when the one asked for could not be drawn. Today
 * the only rung is a 3D drape served as the flat basemap.
 */
export type PreviewDowngrade = 'flat';

/**
 * Compound cache key. The drape and the flat basemap are two entries, and a
 * drape that had to be drawn flat is a third.
 *
 * The downgrade lives in the key rather than beside it because the index is
 * rebuilt on launch by listing this directory, so a filename is the only state
 * that survives a restart. Keys for renders that got what they asked for are
 * unchanged, which is why no cache version bump is owed: every preview already
 * on a device stays valid and stays not-a-downgrade.
 */
function cacheKey(
  activityId: string,
  style: string,
  is3D: boolean,
  downgradedTo?: PreviewDowngrade
): string {
  if (!is3D) return `${activityId}_${style}`;
  return downgradedTo ? `${activityId}_${style}_3d_${downgradedTo}` : `${activityId}_${style}_3d`;
}

/** In-memory index of cached compound keys, least recently served first. */
let cachedKeys: string[] = [];
let initialized = false;

/**
 * Load index from disk on app start.
 * Scans the directory for existing JPEG files and populates the in-memory index.
 */
export async function initTerrainPreviewCache(): Promise<void> {
  try {
    // Check cache version - clear stale snapshots from previous rendering logic
    const storedVersion = await AsyncStorage.getItem(VERSION_KEY);
    if (storedVersion !== String(TERRAIN_CACHE_VERSION)) {
      await clearTerrainPreviews();
      await AsyncStorage.setItem(VERSION_KEY, String(TERRAIN_CACHE_VERSION));
    }

    const dirInfo = await FileSystem.getInfoAsync(TERRAIN_DIR);
    if (!dirInfo.exists) {
      await FileSystem.makeDirectoryAsync(TERRAIN_DIR, { intermediates: true });
      cachedKeys = [];
      initialized = true;
      for (const cb of cacheReadyListeners) cb();
      return;
    }

    const files = await FileSystem.readDirectoryAsync(TERRAIN_DIR);
    const keysOnDisk = files.filter((f) => f.endsWith('.jpg')).map((f) => f.replace('.jpg', ''));
    const storedOrder = await readStoredOrder();
    // The stored order is the whole point: without it the only record of
    // insertion order is each file's write time, and reading those is one
    // native call per file.
    cachedKeys = storedOrder
      ? reconcileTerrainOrder(storedOrder, keysOnDisk)
      : await orderByWriteTime(keysOnDisk.map((k) => `${k}.jpg`));
    writeStoredOrder();
    initialized = true;
    for (const cb of cacheReadyListeners) cb();
  } catch {
    cachedKeys = [];
    initialized = true;
    for (const cb of cacheReadyListeners) cb();
  }
}

/**
 * Reconcile the stored order against what is actually on disk.
 *
 * The files are the truth about what exists and the stored order is the truth
 * about how recently each was served, so each answers the half it knows. A key
 * whose file has gone is dropped. A file the order has never heard of has never
 * been seen served, and the rule below applies: unknown sorts coldest, so it
 * goes to the front and is evicted before a preview that has been served.
 *
 * Pure, and the reason the stat pass is not needed: ordering used to cost one
 * `getInfoAsync` per file, up to 150 of them, at every feed mount.
 */
export function reconcileTerrainOrder(storedOrder: string[], keysOnDisk: string[]): string[] {
  const onDisk = new Set(keysOnDisk);
  const known = new Set(storedOrder);
  const unknownAge = keysOnDisk.filter((key) => !known.has(key));
  const stillThere = storedOrder.filter((key) => onDisk.has(key));
  return [...unknownAge, ...stillThere];
}

/**
 * Eviction takes the front of the index, so rebuilding it in directory order
 * evicts whatever the filesystem happened to name first. That can be the card
 * on screen, which then re-renders and evicts its neighbour in turn. With no
 * stored order there is no record of what was served, and the write time is the
 * only thing left, since a filename is all this cache keeps on disk. A file
 * whose time cannot be read sorts first, so it goes before one whose age is
 * known.
 *
 * Only reached on the first launch after this cache learned to persist its own
 * order, or if that record is lost. Everything after reads the order back.
 */
async function orderByWriteTime(files: string[]): Promise<string[]> {
  const dated = await Promise.all(
    files.map(async (f) => {
      const info = await FileSystem.getInfoAsync(`${TERRAIN_DIR}${f}`);
      const at = info.exists && 'modificationTime' in info ? info.modificationTime : undefined;
      return { key: f.replace('.jpg', ''), at: at ?? 0 };
    })
  );
  return dated.sort((a, b) => a.at - b.at).map((d) => d.key);
}

/** The persisted order, or null when there is none to read. */
async function readStoredOrder(): Promise<string[] | null> {
  try {
    const raw = await AsyncStorage.getItem(ORDER_KEY);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    return parsed.filter((k): k is string => typeof k === 'string');
  } catch {
    return null;
  }
}

/**
 * Record the order the index is in.
 *
 * Not awaited by the callers that mutate the index, and deliberately: those
 * paths promise to drop an entry before they await anything, so a caller cannot
 * see a key whose file is on its way out. A write that is lost or fails costs
 * the next launch one stat pass, which is what every launch used to do, and the
 * reconcile against the directory listing repairs a stale order anyway.
 */
function writeStoredOrder(): void {
  flushOrderWrite();
  void AsyncStorage.setItem(ORDER_KEY, JSON.stringify(cachedKeys)).catch(() => {});
}

type CacheReadyListener = () => void;
const cacheReadyListeners = new Set<CacheReadyListener>();

export function onTerrainCacheReady(cb: CacheReadyListener): () => void {
  cacheReadyListeners.add(cb);
  return () => {
    cacheReadyListeners.delete(cb);
  };
}

export function isTerrainCacheInitialized(): boolean {
  return initialized;
}

/** Ensure directory exists */
async function ensureDir(): Promise<void> {
  const dirInfo = await FileSystem.getInfoAsync(TERRAIN_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(TERRAIN_DIR, { intermediates: true });
  }
}

/**
 * Check if a preview exists for this activity, style and render (sync via
 * in-memory index).
 */
export function hasTerrainPreview(activityId: string, style: string, is3D: boolean): boolean {
  return (
    cachedKeys.includes(cacheKey(activityId, style, is3D)) ||
    cachedKeys.includes(cacheKey(activityId, style, is3D, 'flat'))
  );
}

/**
 * Whether the cached preview for this request is standing in for one that
 * could not be drawn. A card is served either way, so this is what an upgrade
 * pass keys on rather than a miss.
 */
export function isTerrainPreviewDowngraded(
  activityId: string,
  style: string,
  is3D: boolean
): boolean {
  if (cachedKeys.includes(cacheKey(activityId, style, is3D))) return false;
  return cachedKeys.includes(cacheKey(activityId, style, is3D, 'flat'));
}

/**
 * Move a served key to the back of the index, so eviction takes the least
 * recently served rather than the oldest written.
 *
 * Only a serve moves an entry. `hasTerrainPreview` is a predicate the snapshot
 * queue runs over every pending request, and touching from there would reorder
 * the whole cache on a scan that draws nothing.
 */
function touch(key: string): void {
  const at = cachedKeys.indexOf(key);
  if (at === -1 || at === cachedKeys.length - 1) return;
  cachedKeys.splice(at, 1);
  cachedKeys.push(key);
  scheduleOrderWrite();
}

/** Coalesces the writes a scroll would otherwise make one per card. */
let pendingOrderWrite: ReturnType<typeof setTimeout> | null = null;

function scheduleOrderWrite(): void {
  if (pendingOrderWrite) return;
  pendingOrderWrite = setTimeout(() => {
    pendingOrderWrite = null;
    writeStoredOrder();
  }, ORDER_WRITE_COALESCE_MS);
  // React Native's timer ids are numbers. Under Node they are handles that
  // hold the loop open, which is a leaked worker at the end of a test run.
  (pendingOrderWrite as unknown as { unref?: () => void }).unref?.();
}

/**
 * Flush a coalesced order write now. Every path that changes membership calls
 * `writeStoredOrder` directly, so this exists for the serve path alone: a
 * pending timer holding a reorder is why it is cleared before those write.
 */
function flushOrderWrite(): void {
  if (!pendingOrderWrite) return;
  clearTimeout(pendingOrderWrite);
  pendingOrderWrite = null;
}

/**
 * Get cached preview URI (file:// path).
 *
 * Serving is what keeps a preview. The athlete sees the same recent rides
 * every day and those were rendered first, so evicting by write order made one
 * scroll into last year push the cards on screen out, each costing a full 3D
 * re-render to come back.
 */
export function getTerrainPreviewUri(activityId: string, style: string, is3D: boolean): string {
  const asked = cacheKey(activityId, style, is3D);
  if (
    !cachedKeys.includes(asked) &&
    cachedKeys.includes(cacheKey(activityId, style, is3D, 'flat'))
  ) {
    const standIn = cacheKey(activityId, style, is3D, 'flat');
    touch(standIn);
    return `${TERRAIN_DIR}${standIn}.jpg`;
  }
  touch(asked);
  return `${TERRAIN_DIR}${asked}.jpg`;
}

/**
 * Save preview from base64 data. Evicts the least recently served if over cap.
 * Returns the file URI of the saved image.
 */
export async function saveTerrainPreview(
  activityId: string,
  style: string,
  is3D: boolean,
  base64: string,
  options?: { downgradedTo?: PreviewDowngrade }
): Promise<string> {
  await ensureDir();

  const key = cacheKey(activityId, style, is3D, options?.downgradedTo);

  // The drape finally rendered, so its stand-in is not just superseded, it is
  // wrong: leaving it indexed would report the activity as downgraded forever.
  if (!options?.downgradedTo) {
    const stale = cacheKey(activityId, style, is3D, 'flat');
    if (cachedKeys.includes(stale)) {
      cachedKeys = cachedKeys.filter((k) => k !== stale);
      await FileSystem.deleteAsync(`${TERRAIN_DIR}${stale}.jpg`, { idempotent: true }).catch(
        () => {}
      );
    }
  }

  // Evict the coldest if at cap (and the key to save isn't already cached)
  if (!cachedKeys.includes(key) && cachedKeys.length >= MAX_CACHED_PREVIEWS) {
    const evictKey = cachedKeys.shift();
    if (evictKey) {
      const evictPath = `${TERRAIN_DIR}${evictKey}.jpg`;
      await FileSystem.deleteAsync(evictPath, { idempotent: true }).catch(() => {});
    }
  }

  const filePath = `${TERRAIN_DIR}${key}.jpg`;
  await FileSystem.writeAsStringAsync(filePath, base64, {
    encoding: FileSystem.EncodingType.Base64,
  });

  // Update index - remove if already present, add to end
  cachedKeys = cachedKeys.filter((k) => k !== key);
  cachedKeys.push(key);
  // One write for the whole call: the stale drop, the eviction and the append
  // have all landed in the index by here.
  writeStoredOrder();

  return filePath;
}

/**
 * Delete every cached snapshot for one activity, both renders and all styles.
 * Used when the camera override changes to force regeneration.
 *
 * The index is dropped first and the files after. A caller that requests a new
 * snapshot without awaiting this would otherwise see the entry still indexed
 * and drop its request against a file that is on its way out.
 */
export async function deleteTerrainPreviewsForActivity(activityId: string): Promise<void> {
  const prefix = `${activityId}_`;
  const toDelete = cachedKeys.filter((k) => k.startsWith(prefix));
  cachedKeys = cachedKeys.filter((k) => !k.startsWith(prefix));
  writeStoredOrder();

  for (const key of toDelete) {
    const path = `${TERRAIN_DIR}${key}.jpg`;
    await FileSystem.deleteAsync(path, { idempotent: true }).catch(() => {});
  }
}

/**
 * Drop every cached snapshot for one activity except the one just rendered.
 *
 * Called after a render lands, never before, so a failed re-render leaves the
 * card with the image it already had. Without it every style and render the
 * athlete has ever tried for an activity stays on disk under its own key, an
 * unbounded set of orphaned JPEGs per card on anyone who experiments (B416).
 */
export async function deleteSupersededTerrainPreviews(
  activityId: string,
  style: string,
  is3D: boolean
): Promise<void> {
  // Two keys survive, not one. A drape that could not be rendered is saved as a
  // flat stand-in under the 3D key with a downgrade marker, so keeping only the
  // undowngraded key deleted the stand-in that had just landed and left the card
  // holding a uri to nothing. The stand-in is also what an upgrade falls back to
  // when it fails, so it is worth keeping after the real drape arrives.
  const keep = cacheKey(activityId, style, is3D);
  const keepStandIn = cacheKey(activityId, style, is3D, 'flat');
  const prefix = `${activityId}_`;
  const toDelete = cachedKeys.filter(
    (k) => k.startsWith(prefix) && k !== keep && k !== keepStandIn
  );
  if (toDelete.length === 0) return;
  cachedKeys = cachedKeys.filter((k) => !toDelete.includes(k));
  writeStoredOrder();

  for (const key of toDelete) {
    await FileSystem.deleteAsync(`${TERRAIN_DIR}${key}.jpg`, { idempotent: true }).catch(() => {});
  }
}

export async function clearTerrainPreviews(): Promise<void> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(TERRAIN_DIR);
    if (dirInfo.exists) {
      await FileSystem.deleteAsync(TERRAIN_DIR, { idempotent: true });
    }
  } catch {
    // Best effort cleanup
  }
  cachedKeys = [];
  initialized = false;
  // A coalesced serve write still holding the old order would land after the
  // removal and put it back.
  flushOrderWrite();
  // The order has to go with the files, or the next launch reconciles a stored
  // order against an empty directory and keeps nothing anyway, one pass late.
  void AsyncStorage.removeItem(ORDER_KEY).catch(() => {});
}

/**
 * Get total cache size in bytes.
 */
export async function getTerrainPreviewCacheSize(): Promise<number> {
  try {
    const dirInfo = await FileSystem.getInfoAsync(TERRAIN_DIR);
    if (!dirInfo.exists) return 0;

    const files = await FileSystem.readDirectoryAsync(TERRAIN_DIR);
    const jpgFiles = files.filter((f) => f.endsWith('.jpg'));
    if (jpgFiles.length === 0) return 0;

    let totalSize = 0;
    for (const file of jpgFiles) {
      const info = await FileSystem.getInfoAsync(`${TERRAIN_DIR}${file}`);
      if (info.exists && 'size' in info) {
        totalSize += info.size || 0;
      }
    }
    return totalSize;
  } catch {
    return 0;
  }
}

// ============================================================================
// Pending snapshot queue (background task -> foreground generation)
//
// All the list does is mount the render pool without waiting out its 500 ms
// defer. It used to also fill a priority set and ring a listener, and neither
// reached the queue: the set's only reader cleared it, and the listener was
// declared and never assigned. Previews are rendered on demand and there is no
// build-ahead pass, so there is no background job for the list to seed and the
// set had nothing to become. The one priority the queue honours is an athlete
// changing a single card's map.
// ============================================================================

const PENDING_SNAPSHOTS_KEY = 'veloq-pending-terrain-snapshots';

interface PendingSnapshot {
  activityId: string;
  timestamp: number;
}

/**
 * Queue an activity for priority terrain snapshot generation.
 * Called from the background notification task after GPS data is ingested.
 * The feed screen reads this queue on mount and generates snapshots first.
 */
export async function addPendingSnapshot(activityId: string): Promise<void> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_SNAPSHOTS_KEY);
    const pending: PendingSnapshot[] = raw ? JSON.parse(raw) : [];
    if (!pending.some((p) => p.activityId === activityId)) {
      pending.push({ activityId, timestamp: Date.now() });
      // Keep at most 10 pending to avoid unbounded growth
      const trimmed = pending.slice(-10);
      await AsyncStorage.setItem(PENDING_SNAPSHOTS_KEY, JSON.stringify(trimmed));
    }
  } catch {
    // Best effort - snapshot will still be generated on scroll
  }
}

/**
 * Get and clear the pending snapshot queue.
 * Called by the feed screen on mount to prioritize these activities.
 */
export async function consumePendingSnapshots(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(PENDING_SNAPSHOTS_KEY);
    if (!raw) return [];
    await AsyncStorage.removeItem(PENDING_SNAPSHOTS_KEY);
    const pending: PendingSnapshot[] = JSON.parse(raw);
    return pending.map((p) => p.activityId);
  } catch {
    return [];
  }
}
