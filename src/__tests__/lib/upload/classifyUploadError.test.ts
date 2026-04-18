/**
 * Tests for classifyUploadError — the categorization that routes upload
 * failures between "show to user", "queue for later", and "offer OAuth
 * upgrade". Miscategorization here has historically caused data-loss bugs,
 * so the 403-in-message-without-status fallback and the "HTTP status wins
 * over network regex" branches get explicit coverage.
 */

import { classifyUploadError } from '@/lib/upload/classifyUploadError';

function axiosLikeError(status: number, data?: unknown, message?: string): unknown {
  const err = new Error(message ?? `Request failed with status code ${status}`);
  (err as unknown as { response: { status: number; data?: unknown } }).response = {
    status,
    data,
  };
  return err;
}

describe('classifyUploadError', () => {
  describe('http403 detection', () => {
    it('classifies an axios 403 response as http403', () => {
      const result = classifyUploadError(axiosLikeError(403, { message: 'No permission' }));
      expect(result.type).toBe('http403');
      expect(result.httpStatus).toBe(403);
      expect(result.apiDetail).toBe('No permission');
    });

    it('detects 403 from error message when response object is missing', () => {
      const err = new Error('Request failed with status code 403');
      const result = classifyUploadError(err);
      expect(result.type).toBe('http403');
      expect(result.httpStatus).toBe(403);
    });

    it('does not mis-classify a 500 error as 403', () => {
      const result = classifyUploadError(axiosLikeError(500, { error: 'Server oops' }));
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBe(500);
    });
  });

  describe('network error detection', () => {
    it('classifies ERR_NETWORK without a response as network', () => {
      const err = new Error('Network Error ERR_NETWORK');
      const result = classifyUploadError(err);
      expect(result.type).toBe('network');
      expect(result.httpStatus).toBeUndefined();
    });

    it('classifies ECONNABORTED as network', () => {
      const err = new Error('timeout of 10000ms exceeded ECONNABORTED');
      const result = classifyUploadError(err);
      expect(result.type).toBe('network');
    });

    it('classifies "Network Error" message as network', () => {
      const err = new Error('Network Error');
      const result = classifyUploadError(err);
      expect(result.type).toBe('network');
    });

    it('classifies "Network request failed" as network', () => {
      const err = new Error('Network request failed');
      const result = classifyUploadError(err);
      expect(result.type).toBe('network');
    });

    it('does NOT classify as network when an HTTP status is present, even if message mentions network', () => {
      const result = classifyUploadError(
        axiosLikeError(500, null, 'Server returned network error')
      );
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBe(500);
    });
  });

  describe('apiError (default) detection', () => {
    it('classifies a 400 with message body as apiError', () => {
      const result = classifyUploadError(axiosLikeError(400, { message: 'Bad request' }));
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBe(400);
      expect(result.apiDetail).toBe('Bad request');
    });

    it('extracts apiDetail from `error` field when `message` is absent', () => {
      const result = classifyUploadError(axiosLikeError(422, { error: 'Invalid activity' }));
      expect(result.type).toBe('apiError');
      expect(result.apiDetail).toBe('Invalid activity');
    });

    it('extracts apiDetail from a short string body', () => {
      const result = classifyUploadError(axiosLikeError(500, 'Internal error'));
      expect(result.apiDetail).toBe('Internal error');
    });

    it('ignores excessively long string bodies as apiDetail', () => {
      const longBody = 'x'.repeat(600);
      const result = classifyUploadError(axiosLikeError(500, longBody));
      expect(result.apiDetail).toBeUndefined();
    });

    it('treats an unknown-shape error as apiError so users see the raw message', () => {
      const err = new Error('Something weird happened');
      const result = classifyUploadError(err);
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBeUndefined();
      expect(result.errMsg).toBe('Something weird happened');
    });
  });

  describe('errMsg preservation', () => {
    it('preserves the original error message for logging', () => {
      const result = classifyUploadError(new Error('specific diagnostic'));
      expect(result.errMsg).toBe('specific diagnostic');
    });

    it('stringifies non-Error throws', () => {
      const result = classifyUploadError('string throw');
      expect(result.errMsg).toBe('string throw');
      expect(result.type).toBe('apiError'); // no status, no network pattern
    });
  });
});
