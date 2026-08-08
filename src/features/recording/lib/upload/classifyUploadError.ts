/**
 * Classify an upload error so the caller can branch on the user-facing
 * consequence:
 *
 * - `http403` - the server rejected the upload because Veloq doesn't have
 *   write permission. Offer the OAuth upgrade flow.
 * - `network` - no response reached the server. Queue for later and tell the
 *   user the activity is saved offline.
 * - `apiError` - any other response (400/500/etc.). Surface the server
 *   message to the user; do not queue (re-uploading won't help).
 *
 * The classification now comes from the engine: Rust knows whether a write was
 * refused, rate limited or never dispatched, and says so on the outcome carried
 * by an `UploadFailure`. The message-reading fallback below stays for throws the
 * upload seam did not produce, and preserves two subtleties that caused
 * data-loss bugs before:
 *   1. an error carrying an HTTP status is an API error even when its message
 *      mentions "network" (it is not retry-worthy).
 *   2. when no status is available, the literal string "status code 403" in the
 *      message must still be picked up, or a 403 gets mis-classified as a
 *      network error and silently queued.
 */

import type { CallOutcome } from 'veloqrs';

export type UploadErrorType = 'network' | 'http403' | 'apiError';

export interface UploadErrorClassification {
  type: UploadErrorType;
  /** HTTP status code when available (present for `http403`, sometimes for `apiError`). */
  httpStatus?: number;
  /** Server-provided message/description when the response body includes one. */
  apiDetail?: string;
  /** The original error's message - always present, used for logging/diagnostics. */
  errMsg: string;
}

const NETWORK_ERROR_REGEX = /network\s*(error|request\s*failed)|timeout|ERR_NETWORK|ECONNABORTED/i;
const STATUS_403_IN_MESSAGE = /status code 403/i;

/** The engine outcome carried by an `UploadFailure`, if that is what threw. */
function getOutcome(err: unknown): CallOutcome | undefined {
  if (!err || typeof err !== 'object' || !('outcome' in err)) return undefined;
  const outcome = (err as { outcome?: unknown }).outcome;
  if (!outcome || typeof outcome !== 'object') return undefined;
  return typeof (outcome as CallOutcome).kind === 'string' ? (outcome as CallOutcome) : undefined;
}

function fromOutcome(outcome: CallOutcome, errMsg: string): UploadErrorClassification {
  const httpStatus = outcome.status;
  const apiDetail = outcome.detail;

  if (httpStatus === 403) {
    return { type: 'http403', httpStatus: 403, apiDetail, errMsg };
  }
  // Only a request that never reached the server is a network failure. A
  // refused, rate-limited or locally-failed write is not, and queueing one for
  // a connectivity retry would wait on a change that cannot help it.
  if (outcome.kind === 'network') {
    return { type: 'network', errMsg };
  }
  return { type: 'apiError', httpStatus, apiDetail, errMsg };
}

export function classifyUploadError(err: unknown): UploadErrorClassification {
  const errMsg = err instanceof Error ? err.message : String(err);

  const outcome = getOutcome(err);
  if (outcome) return fromOutcome(outcome, errMsg);

  const is403 = STATUS_403_IN_MESSAGE.test(errMsg);
  if (is403) {
    return { type: 'http403', httpStatus: 403, errMsg };
  }

  if (NETWORK_ERROR_REGEX.test(errMsg)) {
    return { type: 'network', errMsg };
  }

  // Unknown shape (no outcome, no network pattern) - treat as API error so the
  // user sees the raw message rather than having it silently queued.
  return { type: 'apiError', errMsg };
}
