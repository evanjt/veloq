/**
 * Adaptive rate limiter for intervals.icu API.
 *
 * This module adheres to the API rate limits stated here:
 * https://forum.intervals.icu/t/solved-guidance-on-api-rate-limits-for-bulk-activity-reloading/110818
 *
 * API Limits:
 * - 30 req/s burst (hard limit)
 * - 132 req/10s sustained (sliding window)
 * - Recommended: 10 req/s for bulk operations
 *
 * Strategy:
 * - Start with high concurrency (up to 20 concurrent, burst mode)
 * - Track requests in 10-second sliding window
 * - Automatically slow down as we approach 132/10s limit
 * - Back off exponentially on 429 responses
 * - Retry failed requests with increasing delay
 * - Gradually restore speed after successful requests
 */

// API limits
const BURST_LIMIT = 30;        // Max requests per second (burst)
const SUSTAINED_LIMIT = 132;   // Max requests per 10 seconds
const WINDOW_MS = 10000;       // 10 second window

// Concurrency settings
// With 2-3s API latency, we need many workers to saturate the rate limit
// 30 req/s × 3s latency = 90 concurrent needed for burst
// 13 req/s × 3s latency = 40 concurrent needed for sustained
const MAX_CONCURRENCY = 60;    // High concurrency to saturate slow API
const MIN_CONCURRENCY = 10;    // Minimum when backing off

// Backoff settings
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 30000;
const BACKOFF_MULTIPLIER = 2;

interface RequestRecord {
  timestamp: number;
}

class AdaptiveRateLimiter {
  private requestHistory: RequestRecord[] = [];
  private currentConcurrency = MAX_CONCURRENCY;
  private backoffMs = 0;
  private consecutiveErrors = 0;
  private totalRequests = 0;
  private totalRetries = 0;
  private total429s = 0;

  /**
   * Get current optimal concurrency based on recent request rate.
   */
  getConcurrency(): number {
    this.pruneOldRequests();

    const requestsInWindow = this.requestHistory.length;
    const utilizationRatio = requestsInWindow / SUSTAINED_LIMIT;

    if (utilizationRatio > 0.9) {
      // Approaching limit, reduce concurrency
      this.currentConcurrency = Math.max(MIN_CONCURRENCY, Math.floor(this.currentConcurrency * 0.7));
    } else if (utilizationRatio < 0.5 && this.consecutiveErrors === 0) {
      // Plenty of headroom, increase concurrency
      this.currentConcurrency = Math.min(MAX_CONCURRENCY, this.currentConcurrency + 2);
    }

    return this.currentConcurrency;
  }

  /**
   * Record a successful request.
   */
  recordSuccess(): void {
    this.requestHistory.push({ timestamp: Date.now() });
    this.totalRequests++;
    this.consecutiveErrors = 0;
    this.backoffMs = 0;
  }

  /**
   * Record a rate limit error (429).
   * Returns the recommended wait time before retrying.
   */
  recordRateLimitError(): number {
    this.total429s++;
    this.consecutiveErrors++;

    // Exponential backoff
    if (this.backoffMs === 0) {
      this.backoffMs = INITIAL_BACKOFF_MS;
    } else {
      this.backoffMs = Math.min(this.backoffMs * BACKOFF_MULTIPLIER, MAX_BACKOFF_MS);
    }

    // Reduce concurrency aggressively on 429
    this.currentConcurrency = Math.max(MIN_CONCURRENCY, Math.floor(this.currentConcurrency / 2));

    console.log(`⚠️ [RateLimiter] 429 received, backing off ${this.backoffMs}ms, concurrency → ${this.currentConcurrency}`);

    return this.backoffMs;
  }

  /**
   * Record a retry attempt.
   */
  recordRetry(): void {
    this.totalRetries++;
  }

  /**
   * Check if we should wait before making more requests.
   * Returns ms to wait, or 0 if we can proceed.
   */
  getWaitTime(): number {
    this.pruneOldRequests();

    const requestsInWindow = this.requestHistory.length;

    // If we're at sustained limit, wait for oldest request to expire
    if (requestsInWindow >= SUSTAINED_LIMIT) {
      const oldestRequest = this.requestHistory[0];
      const waitTime = (oldestRequest.timestamp + WINDOW_MS) - Date.now();
      return Math.max(0, waitTime);
    }

    // Check burst limit (requests in last second)
    const oneSecondAgo = Date.now() - 1000;
    const requestsLastSecond = this.requestHistory.filter(r => r.timestamp > oneSecondAgo).length;

    if (requestsLastSecond >= BURST_LIMIT) {
      // Wait until oldest request in last second expires
      const oldestInSecond = this.requestHistory.find(r => r.timestamp > oneSecondAgo);
      if (oldestInSecond) {
        const waitTime = (oldestInSecond.timestamp + 1000) - Date.now();
        return Math.max(0, waitTime);
      }
    }

    return this.backoffMs;
  }

  /**
   * Remove requests older than the window.
   */
  private pruneOldRequests(): void {
    const cutoff = Date.now() - WINDOW_MS;
    this.requestHistory = this.requestHistory.filter(r => r.timestamp > cutoff);
  }

  /**
   * Get stats for logging.
   */
  getStats(): { total: number; retries: number; rateLimits: number; concurrency: number } {
    return {
      total: this.totalRequests,
      retries: this.totalRetries,
      rateLimits: this.total429s,
      concurrency: this.currentConcurrency,
    };
  }

  /**
   * Reset stats (e.g., at start of new sync).
   */
  reset(): void {
    this.requestHistory = [];
    this.currentConcurrency = MAX_CONCURRENCY;
    this.backoffMs = 0;
    this.consecutiveErrors = 0;
    this.totalRequests = 0;
    this.totalRetries = 0;
    this.total429s = 0;
  }
}

// Singleton instance
export const rateLimiter = new AdaptiveRateLimiter();

interface WorkItem<T> {
  item: T;
  index: number;
  retries: number;
}

/**
 * Worker pool that keeps N workers constantly busy.
 * As soon as one request completes, the worker picks up the next item.
 * This maximizes throughput by never waiting for slow requests to unblock others.
 */
export async function executeWithWorkerPool<T, R>(
  items: T[],
  operation: (item: T) => Promise<R>,
  onProgress?: (completed: number, total: number) => void,
  abortSignal?: AbortSignal
): Promise<Map<number, R>> {
  const results = new Map<number, R>();
  const queue: WorkItem<T>[] = items.map((item, index) => ({ item, index, retries: 0 }));
  let completed = 0;
  let activeWorkers = 0;

  // Get next item from queue (with rate limit check)
  const getNextItem = async (): Promise<WorkItem<T> | null> => {
    if (queue.length === 0) return null;

    // Check if we need to wait for rate limit
    const waitTime = rateLimiter.getWaitTime();
    if (waitTime > 0) {
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }

    return queue.shift() || null;
  };

  // Worker function - keeps processing until queue is empty
  const worker = async (workerId: number): Promise<void> => {
    while (!abortSignal?.aborted) {
      const workItem = await getNextItem();
      if (!workItem) break;

      const { item, index, retries } = workItem;

      try {
        const result = await operation(item);
        rateLimiter.recordSuccess();
        results.set(index, result);
        completed++;
        onProgress?.(completed, items.length);
      } catch (error: unknown) {
        // Check for 429 rate limit error
        const axiosError = error as { response?: { status?: number } };
        const is429 = axiosError?.response?.status === 429;

        if (is429) {
          const backoff = rateLimiter.recordRateLimitError();

          // Re-queue for retry if under max retries
          if (retries < 3) {
            rateLimiter.recordRetry();
            queue.push({ item, index, retries: retries + 1 });
            // Don't increment completed - item is being retried
          } else {
            console.error(`[WorkerPool] Worker ${workerId}: Max retries for item ${index}`);
            completed++;
            onProgress?.(completed, items.length);
          }

          // Brief pause before this worker continues
          await new Promise(resolve => setTimeout(resolve, Math.min(backoff, 500)));
        } else {
          // Non-rate-limit error, skip item
          console.warn(`[WorkerPool] Non-429 error for item ${index}:`, error);
          completed++;
          onProgress?.(completed, items.length);
        }
      }
    }
    activeWorkers--;
  };

  // Start workers up to max concurrency
  const startWorkers = async (): Promise<void> => {
    const maxWorkers = rateLimiter.getConcurrency();
    const workersToStart = Math.min(maxWorkers - activeWorkers, queue.length);

    const workerPromises: Promise<void>[] = [];
    for (let i = 0; i < workersToStart; i++) {
      activeWorkers++;
      workerPromises.push(worker(i));
    }

    await Promise.all(workerPromises);
  };

  await startWorkers();

  const stats = rateLimiter.getStats();
  if (stats.retries > 0 || stats.rateLimits > 0) {
    console.log(`📊 [WorkerPool] Stats: ${stats.total} requests, ${stats.retries} retries, ${stats.rateLimits} rate limits`);
  }

  return results;
}
