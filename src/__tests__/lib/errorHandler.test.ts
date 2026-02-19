import {
  handleAsyncError,
  handleErrorSync,
  safeAsync,
  safeSync,
  isNetworkError,
} from '@/lib/utils/errorHandler';

describe('errorHandler', () => {
  describe('handleAsyncError', () => {
    it('returns resolved value on success', async () => {
      const result = await handleAsyncError(Promise.resolve(42), 'Test');
      expect(result).toBe(42);
    });

    it('re-throws on critical level (default)', async () => {
      await expect(handleAsyncError(Promise.reject(new Error('fail')), 'Test')).rejects.toThrow(
        'fail'
      );
    });

    it('returns fallback on warning level', async () => {
      const result = await handleAsyncError(Promise.reject(new Error('fail')), 'Test', {
        level: 'warning',
        fallback: 'default',
      });
      expect(result).toBe('default');
    });

    it('returns fallback on silent level', async () => {
      const result = await handleAsyncError(Promise.reject(new Error('fail')), 'Test', {
        level: 'silent',
        fallback: null,
      });
      expect(result).toBeNull();
    });

    it('uses options.context for error prefix when provided', async () => {
      const spy = jest.spyOn(console, 'warn').mockImplementation();
      await handleAsyncError(Promise.reject(new Error('fail')), 'DefaultCtx', {
        level: 'warning',
        fallback: null,
        context: 'CustomCtx',
      });
      expect(spy).toHaveBeenCalledWith('[CustomCtx] Warning (using fallback):', 'fail');
      spy.mockRestore();
    });

    it('returns fallback with log:false on silent level', async () => {
      const result = await handleAsyncError(Promise.reject(new Error('fail')), 'Test', {
        level: 'silent',
        fallback: 'safe',
        log: false,
      });
      expect(result).toBe('safe');
    });

    it('handles non-Error rejections', async () => {
      const result = await handleAsyncError(Promise.reject('string error'), 'Test', {
        level: 'warning',
        fallback: 'fallback',
      });
      expect(result).toBe('fallback');
    });
  });

  describe('handleErrorSync', () => {
    it('returns value on success', () => {
      const result = handleErrorSync(() => 42, 'Test');
      expect(result).toBe(42);
    });

    it('re-throws on critical level', () => {
      expect(() =>
        handleErrorSync(() => {
          throw new Error('fail');
        }, 'Test')
      ).toThrow('fail');
    });

    it('returns fallback on warning level', () => {
      const result = handleErrorSync(
        () => {
          throw new Error('fail');
        },
        'Test',
        { level: 'warning', fallback: 'default' }
      );
      expect(result).toBe('default');
    });

    it('returns fallback on silent level', () => {
      const result = handleErrorSync(
        () => {
          throw new Error('fail');
        },
        'Test',
        { level: 'silent', fallback: null }
      );
      expect(result).toBeNull();
    });
  });

  describe('safeAsync', () => {
    it('returns [null, data] on success', async () => {
      const safeFn = safeAsync(async (x: number) => x * 2);
      const [error, data] = await safeFn(5);
      expect(error).toBeNull();
      expect(data).toBe(10);
    });

    it('returns [error, null] on failure', async () => {
      const safeFn = safeAsync(async () => {
        throw new Error('boom');
      });
      const [error, data] = await safeFn();
      expect(error).toBeInstanceOf(Error);
      expect((error as Error).message).toBe('boom');
      expect(data).toBeNull();
    });
  });

  describe('safeSync', () => {
    it('returns [null, data] on success', () => {
      const safeParse = safeSync(JSON.parse);
      const [error, data] = safeParse('{"a":1}');
      expect(error).toBeNull();
      expect(data).toEqual({ a: 1 });
    });

    it('returns [error, null] on failure', () => {
      const safeParse = safeSync(JSON.parse);
      const [error, data] = safeParse('invalid json');
      expect(error).toBeInstanceOf(Error);
      expect(data).toBeNull();
    });
  });

  describe('isNetworkError', () => {
    it('returns true for ERR_NETWORK', () => {
      expect(isNetworkError({ code: 'ERR_NETWORK' })).toBe(true);
    });

    it('returns true for ECONNABORTED', () => {
      expect(isNetworkError({ code: 'ECONNABORTED' })).toBe(true);
    });

    it('returns true for ETIMEDOUT', () => {
      expect(isNetworkError({ code: 'ETIMEDOUT' })).toBe(true);
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
