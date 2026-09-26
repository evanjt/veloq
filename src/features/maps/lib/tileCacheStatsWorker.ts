/**
 * Which snapshot worker can answer a tile-cache stats request.
 *
 * The script the request injects reads `caches` and posts back through
 * `ReactNativeWebView`, and neither needs a map. Gating on `mapReady` therefore
 * asked for a condition the answer does not depend on, and offline no worker
 * ever reaches it: the style resolve fails, `map.on('load')` never fires, and
 * the settings panel reports 0 bytes over a cache holding up to 200 MB.
 *
 * The honest gate is the document, which is where `window._workerId` is set and
 * where `caches` becomes available. One worker answers rather than all of them,
 * because they share an origin and so share the cache: asking a second would
 * post the same numbers twice.
 */
export interface StatsWorkerCandidate {
  documentReady: boolean;
  hasView: boolean;
}

export function pickStatsWorker<T extends StatsWorkerCandidate>(workers: T[]): T | null {
  return workers.find((w) => w.documentReady && w.hasView) ?? null;
}
