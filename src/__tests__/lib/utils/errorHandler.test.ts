/**
 * Tests for errorHandler utility
 *
 * Tests standardized error handling with different severity levels.
 */

import { handleAsyncError, safeAsync } from '@/lib/utils/errorHandler';

describe('handleAsyncError', () => {
  it('should return successful result', async () => {
    const promise = Promise.resolve('success');
    const result = await handleAsyncError(promise, 'test context');

    expect(result).toBe('success');
  });

  it('should throw critical errors', async () => {
    const error = new Error('Critical failure');
    const promise = Promise.reject(error);

    await expect(handleAsyncError(promise, 'test', { level: 'critical' })).rejects.toThrow(
      'Critical failure'
    );
  });

  it('should return fallback for warning level errors', async () => {
    const error = new Error('Warning failure');
    const promise = Promise.reject(error);

    const result = await handleAsyncError(promise, 'test', {
      level: 'warning',
      fallback: 'fallback value',
    });

    expect(result).toBe('fallback value');
  });

  it('should return fallback for silent errors', async () => {
    const error = new Error('Silent failure');
    const promise = Promise.reject(error);

    const result = await handleAsyncError(promise, 'test', {
      level: 'silent',
      fallback: 'default',
    });

    expect(result).toBe('default');
  });

  it('should use context in error message', async () => {
    const error = new Error('Test error');
    const promise = Promise.reject(error);
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

    try {
      await handleAsyncError(promise, 'CustomContext', { level: 'critical' });
    } catch {
      // Expected to throw
    }

    expect(consoleSpy).toHaveBeenCalledWith(
      expect.stringContaining('[CustomContext]'),
      expect.any(String)
    );

    consoleSpy.mockRestore();
  });
});

describe('safeAsync', () => {
  it('should return [null, data] for successful promise', async () => {
    const fn = async () => 'success';
    const wrapped = safeAsync(fn);

    const [error, data] = await wrapped();

    expect(error).toBeNull();
    expect(data).toBe('success');
  });

  it('should return [error, null] for failed promise', async () => {
    const fn = async () => {
      throw new Error('Failure');
    };
    const wrapped = safeAsync(fn);

    const [error, data] = await wrapped();

    expect(error).toBeInstanceOf(Error);
    expect(error?.message).toBe('Failure');
    expect(data).toBeNull();
  });

  it('should pass arguments to wrapped function', async () => {
    const fn = async (a: number, b: number) => a + b;
    const wrapped = safeAsync(fn);

    const [error, data] = await wrapped(2, 3);

    expect(error).toBeNull();
    expect(data).toBe(5);
  });

  it('should handle multiple sequential calls', async () => {
    const fn = async (value: number) => value * 2;
    const wrapped = safeAsync(fn);

    const [, result1] = await wrapped(5);
    const [, result2] = await wrapped(10);

    expect(result1).toBe(10);
    expect(result2).toBe(20);
  });

  it('should handle rethrows in wrapped functions', async () => {
    class CustomError extends Error {
      constructor(message: string) {
        super(message);
        this.name = 'CustomError';
      }
    }

    const fn = async () => {
      throw new CustomError('Custom failure');
    };
    const wrapped = safeAsync(fn);

    const [error] = await wrapped();

    expect(error).toBeInstanceOf(CustomError);
    expect(error?.message).toBe('Custom failure');
  });
});

describe('Integration Tests', () => {
  it('should handle complex error scenarios with fallbacks', async () => {
    type UserData = { id: number; name: string };

    const fetchUser = async (id: number): Promise<UserData> => {
      if (id === 0) throw new Error('Invalid ID');
      return { id, name: `User ${id}` };
    };

    const wrapped = safeAsync(fetchUser);

    // Success case
    const [, user] = await wrapped(1);
    expect(user).toEqual({ id: 1, name: 'User 1' });

    // Error case with fallback
    const [error] = await wrapped(0);
    expect(error).toBeInstanceOf(Error);
  });

  it('should work with handleAsyncError for complex flows', async () => {
    const riskyOperation = async (shouldFail: boolean) => {
      if (shouldFail) throw new Error('Operation failed');
      return 'Operation succeeded';
    };

    // Success path
    const result1 = await handleAsyncError(riskyOperation(false), 'operation', {
      level: 'critical',
    });
    expect(result1).toBe('Operation succeeded');

    // Failure with fallback
    const result2 = await handleAsyncError(riskyOperation(true), 'operation', {
      level: 'warning',
      fallback: 'Default result',
    });
    expect(result2).toBe('Default result');
  });
});
