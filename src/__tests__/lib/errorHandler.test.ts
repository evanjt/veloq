import { isNetworkError } from '@/shared/errors/errorHandler';

describe('errorHandler', () => {
  describe('isNetworkError', () => {
    it('returns true for ERR_NETWORK', () => {
      expect(isNetworkError({ code: 'ERR_NETWORK' })).toBe(true);
    });

    it('returns false for other error codes', () => {
      expect(isNetworkError({ code: 'ERR_BAD_REQUEST' })).toBe(false);
    });

    it('returns false for no code', () => {
      expect(isNetworkError({})).toBe(false);
      expect(isNetworkError(null)).toBe(false);
      expect(isNetworkError(undefined)).toBe(false);
    });

    it('returns false for non-object errors', () => {
      expect(isNetworkError('ERR_NETWORK')).toBe(false);
    });
  });
});
