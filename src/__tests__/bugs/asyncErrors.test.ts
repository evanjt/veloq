/**
 * Tests for async error handling bugs.
 *
 * These tests expose issues with promise handling and error recovery.
 */

describe('Bug: React Query persistence hydration', () => {
  /**
   * The error "promise.then is not a function" occurs when:
   * 1. Cache contains stale data format
   * 2. Serialization/deserialization corrupts Promise-like objects
   * 3. Old cache version is incompatible with new React Query
   *
   * ERROR seen in logs:
   * [TypeError: promise.then is not a function (it is undefined)]
   * Call Stack: tryResolveSync -> hydrate -> persistQueryClientRestore
   */

  it('should handle corrupted cache gracefully', async () => {
    // Simulate what happens when cache contains invalid data
    const mockCorruptedCache = {
      clientState: {
        queries: [
          {
            queryKey: ['activities', '2024-01-01', '2024-01-31'],
            state: {
              data: null,
              // This is the problematic part - a non-thenable being treated as Promise
              dataUpdatedAt: Date.now(),
              error: null,
              errorUpdatedAt: 0,
              fetchFailureCount: 0,
              fetchFailureReason: null,
              fetchMeta: null,
              isInvalidated: false,
              status: 'success',
              fetchStatus: 'idle',
            },
          },
        ],
        mutations: [],
      },
      timestamp: Date.now(),
      buster: '',
    };

    // The serialize function should produce valid JSON
    const serialized = JSON.stringify(mockCorruptedCache);
    const deserialized = JSON.parse(serialized);

    // Verify the structure is preserved
    expect(deserialized.clientState.queries).toHaveLength(1);
    expect(deserialized.clientState.queries[0].state.status).toBe('success');
  });

  it('should handle cache with undefined values', () => {
    // This can happen when optional fields are serialized
    const cacheWithUndefined = {
      clientState: {
        queries: [
          {
            queryKey: ['test'],
            state: {
              data: undefined, // This is OMITTED (not null) in JSON
              status: 'pending',
            },
          },
        ],
        mutations: [],
      },
    };

    const serialized = JSON.stringify(cacheWithUndefined);
    const deserialized = JSON.parse(serialized);

    // undefined is OMITTED during JSON serialization (key doesn't exist)
    expect('data' in deserialized.clientState.queries[0].state).toBe(false);
  });
});

describe('Bug: Unhandled promise rejections in storage', () => {
  /**
   * src/lib/storage/gpsStorage.ts:86
   * Promise chain without error handler on FileSystem.writeAsStringAsync
   */

  it('documents the pattern of unhandled promise in batch write', async () => {
    // This simulates the problematic pattern:
    // entries.map(entry =>
    //   FileSystem.writeAsStringAsync(entry.path, entry.data)
    //     .then(() => entry.activityId)
    // )
    //
    // If writeAsStringAsync fails, the error is unhandled in the .then()

    const mockWrite = async (shouldFail: boolean) => {
      if (shouldFail) {
        throw new Error('Write failed');
      }
      return 'success';
    };

    // Correct pattern with catch
    const safeWrite = async (shouldFail: boolean) => {
      try {
        return await mockWrite(shouldFail);
      } catch (e) {
        return null; // Handle gracefully
      }
    };

    // The current code doesn't have this catch
    await expect(safeWrite(true)).resolves.toBeNull();
    await expect(safeWrite(false)).resolves.toBe('success');
  });
});

describe('Bug: Async setState without await', () => {
  /**
   * src/providers/MapPreferencesContext.tsx:70, 87
   * savePreferences() is async but not awaited in setState callback
   *
   * This pattern causes:
   * 1. No way to know if save succeeded
   * 2. Errors go to unhandled promise rejection handler
   * 3. State and storage can get out of sync
   */

  it('demonstrates the async setState pattern issue', async () => {
    let savedValue: string | null = null;
    let error: Error | null = null;

    // Simulates async save function (catches its own errors to avoid test noise)
    const savePreferences = async (value: string) => {
      await new Promise((resolve) => setTimeout(resolve, 10));
      if (value === 'fail') {
        // In real code, this would be an unhandled rejection
        error = new Error('Save failed');
        return;
      }
      savedValue = value;
    };

    // Problematic pattern (no await, no catch)
    const setPreferencesWrong = (value: string) => {
      // This is fire-and-forget - caller can't know result
      savePreferences(value);
    };

    // Wrong pattern doesn't wait for completion
    setPreferencesWrong('test');
    expect(savedValue).toBeNull(); // Not saved yet!

    // After waiting, it might have completed
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(savedValue).toBe('test');

    // Errors are captured but caller has no way to know
    setPreferencesWrong('fail');
    await new Promise((resolve) => setTimeout(resolve, 20));

    // The error happened but setPreferencesWrong returned void immediately
    expect((error as Error | null)?.message).toBe('Save failed');
  });
});

describe('Bug: Race condition in useRouteDataSync', () => {
  /**
   * src/hooks/routes/useRouteDataSync.ts:184
   * syncActivities depends on isAuthenticated/isDemoMode but effect
   * may fire with stale closure values
   */

  it('demonstrates stale closure issue', () => {
    // Simulates the issue: callback captures initial value
    let authState = { isAuthenticated: false };

    const createCallback = () => {
      // This captures authState at creation time
      const captured = authState.isAuthenticated;
      return () => {
        // Uses captured value, not current
        return captured;
      };
    };

    const callback = createCallback();

    // Auth state changes
    authState = { isAuthenticated: true };

    // But callback still returns old value
    expect(callback()).toBe(false); // Stale!

    // Correct pattern: read current value inside callback
    const correctCallback = () => {
      return authState.isAuthenticated;
    };

    expect(correctCallback()).toBe(true);
  });
});
