/**
 * Tests for classifyUploadError - the categorization that routes upload
 * failures between "show to user", "queue for later", and "offer OAuth
 * upgrade". Miscategorization here has historically caused data-loss bugs,
 * so the 403-in-message-without-an-outcome fallback and the "HTTP status wins
 * over network regex" branches get explicit coverage.
 *
 * The status now arrives on the engine outcome the upload seam attaches to the
 * thrown error, rather than being read off an axios response.
 */

import { classifyUploadError } from '@/features/recording/lib/upload/classifyUploadError';

/** An error shaped the way the upload seam throws one. */
function refused(kind: string, status?: number, detail?: string, message?: string): unknown {
  const text = message ?? `HTTP ${status ?? '?'}: ${detail ?? ''}`;
  return Object.assign(new Error(text), { outcome: { kind, status, detail, message: text } });
}

describe('classifyUploadError', () => {
  describe('http403 detection', () => {
    it('classifies a refused write with status 403 as http403', () => {
      const result = classifyUploadError(refused('http', 403, 'No permission'));
      expect(result.type).toBe('http403');
      expect(result.httpStatus).toBe(403);
      expect(result.apiDetail).toBe('No permission');
    });

    it('detects 403 from the error message when no outcome is attached', () => {
      const err = new Error('Request failed with status code 403');
      const result = classifyUploadError(err);
      expect(result.type).toBe('http403');
      expect(result.httpStatus).toBe(403);
    });

    it('does not mis-classify a 500 error as 403', () => {
      const result = classifyUploadError(refused('http', 500, 'Server oops'));
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBe(500);
    });
  });

  describe('network error detection', () => {
    it('classifies a request that never reached the server as network', () => {
      const result = classifyUploadError(
        refused('network', undefined, undefined, 'transport error: connection reset')
      );
      expect(result.type).toBe('network');
      expect(result.httpStatus).toBeUndefined();
    });

    it('classifies connectivity messages without an outcome as network', () => {
      const messages = [
        'Network Error ERR_NETWORK',
        'timeout of 10000ms exceeded ECONNABORTED',
        'Network Error',
        'Network request failed',
      ];
      for (const message of messages) {
        const result = classifyUploadError(new Error(message));
        expect(result.type).toBe('network');
        expect(result.httpStatus).toBeUndefined();
      }
    });

    it('does NOT classify as network when the server answered, even if the message mentions network', () => {
      const result = classifyUploadError(
        refused('http', 500, undefined, 'Server returned network error')
      );
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBe(500);
    });

    it('does NOT classify a local engine failure as network', () => {
      // Waiting for connectivity cannot fix a missing file or a cold engine.
      const result = classifyUploadError(
        refused('internal', undefined, undefined, 'file error: cannot open /rec/1.fit')
      );
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBeUndefined();
    });
  });

  describe('apiError (default) detection', () => {
    it('classifies a 400 with a message body as apiError', () => {
      const result = classifyUploadError(refused('http', 400, 'Bad request'));
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBe(400);
      expect(result.apiDetail).toBe('Bad request');
    });

    it('carries the detail the engine extracted from the response body', () => {
      const result = classifyUploadError(refused('http', 422, 'Invalid activity'));
      expect(result.type).toBe('apiError');
      expect(result.apiDetail).toBe('Invalid activity');
    });

    it('leaves apiDetail unset when the body carried nothing worth showing', () => {
      const result = classifyUploadError(refused('http', 500, undefined, 'HTTP 500: '));
      expect(result.apiDetail).toBeUndefined();
      expect(result.errMsg).toBe('HTTP 500: ');
    });

    it('maps a rejected credential to its status rather than to a network failure', () => {
      const result = classifyUploadError(
        refused('unauthorized', 401, undefined, 'unauthorized (401)')
      );
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBe(401);
    });

    it('maps a rate-limited write to 429', () => {
      const result = classifyUploadError(
        refused('rateLimited', 429, undefined, 'rate limited (429) after retries')
      );
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBe(429);
    });

    it('treats an unknown-shape error as apiError so users see the raw message', () => {
      const err = new Error('Something weird happened');
      const result = classifyUploadError(err);
      expect(result.type).toBe('apiError');
      expect(result.httpStatus).toBeUndefined();
      expect(result.errMsg).toBe('Something weird happened');
    });

    it('ignores an attached value that is not an outcome', () => {
      const err = Object.assign(new Error('Network Error'), { outcome: 'nonsense' });
      const result = classifyUploadError(err);
      expect(result.type).toBe('network');
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
      expect(result.type).toBe('apiError'); // no outcome, no network pattern
    });
  });
});
