/**
 * Classify an upload error so the caller can branch on the user-facing
 * consequence:
 *
 * - `http403` — the server rejected the upload because Veloq doesn't have
 *   write permission. Offer the OAuth upgrade flow.
 * - `network` — no response reached the server. Queue for later and tell the
 *   user the activity is saved offline.
 * - `apiError` — any other response (400/500/etc.). Surface the server
 *   message to the user; do not queue (re-uploading won't help).
 *
 * Historically the detection had two subtleties that caused data-loss bugs:
 *   1. axios errors with a `response.status` should be treated as API errors
 *      even if their top-level message mentions "network" (they are not
 *      retry-worthy).
 *   2. When `response` is missing, the literal string "status code 403" can
 *      still appear in the error message — we must pick that up so a 403
 *      doesn't get mis-classified as a network error and silently queued.
 */

export type UploadErrorType = 'network' | 'http403' | 'apiError';

export interface UploadErrorClassification {
  type: UploadErrorType;
  /** HTTP status code when available (present for `http403`, sometimes for `apiError`). */
  httpStatus?: number;
  /** Server-provided message/description when the response body includes one. */
  apiDetail?: string;
  /** The original error's message — always present, used for logging/diagnostics. */
  errMsg: string;
}

const NETWORK_ERROR_REGEX = /network\s*(error|request\s*failed)|timeout|ERR_NETWORK|ECONNABORTED/i;
const STATUS_403_IN_MESSAGE = /status code 403/i;

/** Extract an axios-style `response` object if present on the error. */
function getResponse(err: unknown): { status?: number; data?: unknown } | undefined {
  if (err && typeof err === 'object' && 'response' in err) {
    return (err as { response?: { status?: number; data?: unknown } }).response;
  }
  return undefined;
}

/** Pull a user-facing detail string out of a response body, if one is there. */
function extractApiDetail(data: unknown): string | undefined {
  if (data && typeof data === 'object' && 'message' in data) {
    return String((data as Record<string, unknown>).message);
  }
  if (data && typeof data === 'object' && 'error' in data) {
    return String((data as Record<string, unknown>).error);
  }
  if (typeof data === 'string' && data.length > 0 && data.length < 500) {
    return data;
  }
  return undefined;
}

export function classifyUploadError(err: unknown): UploadErrorClassification {
  const errMsg = err instanceof Error ? err.message : String(err);
  const response = getResponse(err);
  const httpStatus = response?.status;
  const apiDetail = extractApiDetail(response?.data);

  const is403 =
    httpStatus === 403 || (httpStatus === undefined && STATUS_403_IN_MESSAGE.test(errMsg));
  if (is403) {
    return { type: 'http403', httpStatus: httpStatus ?? 403, apiDetail, errMsg };
  }

  // Any HTTP status (other than 403 handled above) is an API error, not network.
  if (httpStatus !== undefined) {
    return { type: 'apiError', httpStatus, apiDetail, errMsg };
  }

  // No HTTP status → network failure if the message looks like one.
  if (NETWORK_ERROR_REGEX.test(errMsg)) {
    return { type: 'network', errMsg };
  }

  // Unknown shape (no status, no network pattern) — treat as API error so the
  // user sees the raw message rather than having it silently queued.
  return { type: 'apiError', apiDetail, errMsg };
}
