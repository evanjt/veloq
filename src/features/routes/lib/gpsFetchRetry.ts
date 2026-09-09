/**
 * Retrying the GPS downloads that failed.
 *
 * `startFetchAndStore` reports its failures in `failedIds`, and the caller read
 * the length for a log line and dropped the ids. A failed activity was then
 * re-attempted only when some later pass happened to notice it missing from
 * `getActivityIds()`, which depends on an unrelated trigger firing, so the
 * athlete saw a route that never got its map. The elevation backfill is the
 * model: a failed fetch leaves its row untouched and the derived queue re-offers
 * it. Here the re-offer is immediate and bounded, over the failed ids alone.
 *
 * A download that just failed usually failed on the network, so the retries back
 * off rather than hammering the same activity three times in a row.
 */

/** What one pass over a set of ids reports back. */
export interface FetchPass {
  syncedIds: string[];
  failedIds: string[];
  total: number;
  successCount: number;
}

export interface RetryOptions {
  /** Runs one download pass over these ids. `null` when it gave no result. */
  pass: (ids: string[]) => Promise<FetchPass | null>;
  /** Stops before the next retry as soon as this reads false. */
  isActive?: () => boolean;
  /** Waits between passes. Defaults to a real timer. */
  wait?: (ms: number) => Promise<void>;
  /** Passes in total, counting the first. */
  maxAttempts?: number;
  /** Delay before the first retry. Each later one waits twice as long. */
  retryDelayMs?: number;
  /** Called as each retry starts, with what it is re-offering. */
  onRetry?: (ids: string[], attempt: number) => void;
}

export interface RetrySummary extends FetchPass {
  /** Passes actually run. Zero for an empty set. */
  attempts: number;
  /** Ids that only came through on a retry. */
  recoveredIds: string[];
}

const DEFAULT_MAX_ATTEMPTS = 3;
const DEFAULT_RETRY_DELAY_MS = 2000;

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Downloads `ids`, then re-offers whatever failed until it comes through or the
 * attempts run out. Answers null only when the very first pass gave no result,
 * which is the caller's cancelled case: past that the successes are already
 * stored and are reported however the retries go.
 */
export async function fetchWithRetry(
  ids: string[],
  options: RetryOptions
): Promise<RetrySummary | null> {
  const {
    pass,
    isActive = () => true,
    wait = sleep,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryDelayMs = DEFAULT_RETRY_DELAY_MS,
    onRetry,
  } = options;

  if (ids.length === 0) {
    return {
      syncedIds: [],
      failedIds: [],
      total: 0,
      successCount: 0,
      attempts: 0,
      recoveredIds: [],
    };
  }

  const first = await pass(ids);
  if (!first) return null;

  const syncedIds = [...first.syncedIds];
  const recoveredIds: string[] = [];
  let pending = [...first.failedIds];
  let attempts = 1;

  while (pending.length > 0 && attempts < maxAttempts && isActive()) {
    await wait(retryDelayMs * 2 ** (attempts - 1));
    if (!isActive()) break;

    attempts += 1;
    const retrying = pending;
    onRetry?.(retrying, attempts);

    const next = await pass(retrying);
    if (!next) break;

    syncedIds.push(...next.syncedIds);
    recoveredIds.push(...next.syncedIds);
    pending = [...next.failedIds];
  }

  return {
    syncedIds,
    failedIds: pending,
    total: first.total,
    successCount: syncedIds.length,
    attempts,
    recoveredIds,
  };
}
