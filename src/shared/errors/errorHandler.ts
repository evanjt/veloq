/**
 * @fileoverview Network error detection.
 */

const NETWORK_ERROR_CODES = ['ERR_NETWORK', 'ECONNABORTED', 'ETIMEDOUT'];

/**
 * Check if an error is a network connectivity error (axios error codes).
 */
export function isNetworkError(error: unknown): boolean {
  const code = (error as { code?: string })?.code;
  return !!code && NETWORK_ERROR_CODES.includes(code);
}
