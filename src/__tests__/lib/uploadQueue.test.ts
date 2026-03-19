/**
 * Tests for upload queue storage utilities.
 * Mocks expo-file-system and AsyncStorage for deterministic operations.
 *
 * Covers: enqueueUpload, dequeueUpload, markUploadComplete, markUploadFailed,
 *         getQueueSize, clearUploadQueue, retry logic, persistence, edge cases.
 */

// Mock the debug module to avoid __DEV__ reference error in node test environment
jest.mock('@/lib/utils/debug', () => ({
  debug: {
    log: () => {},
    warn: () => {},
    error: () => {},
    create: () => ({ log: () => {}, warn: () => {}, error: () => {} }),
  },
}));

// Mock AsyncStorage with jest.fn() so we can control return values per test
jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn().mockResolvedValue(null),
    setItem: jest.fn().mockResolvedValue(undefined),
    removeItem: jest.fn().mockResolvedValue(undefined),
  },
}));

// In-memory file system for testing
const mockFileStore = new Map<string, string>();
const mockDirStore = new Set<string>();

jest.mock('expo-file-system/legacy', () => ({
  documentDirectory: '/mock/docs/',
  getInfoAsync: jest.fn(async (path: string) => {
    if (mockDirStore.has(path) || mockFileStore.has(path)) {
      const size = mockFileStore.has(path) ? mockFileStore.get(path)!.length : 0;
      return { exists: true, isDirectory: mockDirStore.has(path), size };
    }
    return { exists: false, isDirectory: false };
  }),
  makeDirectoryAsync: jest.fn(async (path: string) => {
    mockDirStore.add(path);
  }),
  deleteAsync: jest.fn(async (path: string) => {
    for (const key of [...mockFileStore.keys()]) {
      if (key === path || key.startsWith(path)) mockFileStore.delete(key);
    }
    mockDirStore.delete(path);
  }),
}));

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  enqueueUpload,
  dequeueUpload,
  markUploadComplete,
  markUploadFailed,
  getQueueSize,
  clearUploadQueue,
} from '@/lib/storage/uploadQueue';

const QUEUE_KEY = 'veloq-upload-queue';

function makeEntry(overrides: Record<string, unknown> = {}) {
  return {
    filePath: '/mock/docs/pending_uploads/test.fit',
    activityType: 'Ride' as const,
    name: 'Morning Ride',
    createdAt: Date.now(),
    ...overrides,
  };
}

beforeEach(() => {
  mockFileStore.clear();
  mockDirStore.clear();
  jest.clearAllMocks();
  (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);
  (AsyncStorage.setItem as jest.Mock).mockResolvedValue(undefined);
  (AsyncStorage.removeItem as jest.Mock).mockResolvedValue(undefined);
});

describe('enqueueUpload', () => {
  it('returns a unique string id', async () => {
    const id = await enqueueUpload(makeEntry());
    expect(typeof id).toBe('string');
    expect(id.length).toBeGreaterThan(0);
  });

  it('generates unique ids for successive enqueues', async () => {
    const id1 = await enqueueUpload(makeEntry());
    const id2 = await enqueueUpload(makeEntry());
    expect(id1).not.toBe(id2);
  });

  it('persists the entry to AsyncStorage', async () => {
    await enqueueUpload(makeEntry());
    expect(AsyncStorage.setItem).toHaveBeenCalledWith(
      QUEUE_KEY,
      expect.stringContaining('Morning Ride')
    );
  });

  it('initializes retryCount to 0', async () => {
    await enqueueUpload(makeEntry());
    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const queue = JSON.parse(storedJson);
    expect(queue[0].retryCount).toBe(0);
  });

  it('preserves all fields from the entry', async () => {
    await enqueueUpload(makeEntry({ pairedEventId: 42, name: 'Custom Ride' }));
    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const queue = JSON.parse(storedJson);
    expect(queue[0].name).toBe('Custom Ride');
    expect(queue[0].pairedEventId).toBe(42);
    expect(queue[0].activityType).toBe('Ride');
    expect(queue[0].filePath).toBe('/mock/docs/pending_uploads/test.fit');
  });

  it('appends to an existing queue', async () => {
    // First enqueue
    await enqueueUpload(makeEntry({ name: 'Ride 1' }));
    // Simulate existing queue in storage for the second call
    const firstQueue = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[0][1]);
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(firstQueue));

    await enqueueUpload(makeEntry({ name: 'Ride 2' }));
    const secondQueue = JSON.parse((AsyncStorage.setItem as jest.Mock).mock.calls[1][1]);
    expect(secondQueue).toHaveLength(2);
    expect(secondQueue[0].name).toBe('Ride 1');
    expect(secondQueue[1].name).toBe('Ride 2');
  });

  it('creates the uploads directory if it does not exist', async () => {
    const FileSystem = require('expo-file-system/legacy');
    await enqueueUpload(makeEntry());
    expect(FileSystem.makeDirectoryAsync).toHaveBeenCalledWith('/mock/docs/pending_uploads/', {
      intermediates: true,
    });
  });

  it('does not recreate directory if it already exists', async () => {
    const FileSystem = require('expo-file-system/legacy');
    mockDirStore.add('/mock/docs/pending_uploads/');
    await enqueueUpload(makeEntry());
    expect(FileSystem.makeDirectoryAsync).not.toHaveBeenCalled();
  });
});

describe('dequeueUpload', () => {
  it('returns null for an empty queue', async () => {
    const entry = await dequeueUpload();
    expect(entry).toBeNull();
  });

  it('returns the first entry in the queue', async () => {
    const queue = [
      { ...makeEntry({ name: 'First' }), id: 'id-1', retryCount: 0 },
      { ...makeEntry({ name: 'Second' }), id: 'id-2', retryCount: 0 },
    ];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    const entry = await dequeueUpload();
    expect(entry).not.toBeNull();
    expect(entry!.name).toBe('First');
    expect(entry!.id).toBe('id-1');
  });

  it('does not remove the entry from the queue (peek behavior)', async () => {
    const queue = [{ ...makeEntry(), id: 'id-1', retryCount: 0 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await dequeueUpload();
    // setItem should NOT be called (queue is not modified)
    expect(AsyncStorage.setItem).not.toHaveBeenCalled();
  });

  it('handles corrupt AsyncStorage data gracefully', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('not valid json{{{');
    const entry = await dequeueUpload();
    expect(entry).toBeNull();
  });
});

describe('markUploadComplete', () => {
  it('removes the entry from the queue', async () => {
    const queue = [
      { ...makeEntry({ name: 'Ride 1' }), id: 'id-1', retryCount: 0 },
      { ...makeEntry({ name: 'Ride 2' }), id: 'id-2', retryCount: 0 },
    ];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadComplete('id-1');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue).toHaveLength(1);
    expect(updatedQueue[0].id).toBe('id-2');
  });

  it('cleans up the file on disk', async () => {
    const filePath = '/mock/docs/pending_uploads/test.fit';
    mockFileStore.set(filePath, 'file-content');
    const queue = [{ ...makeEntry({ filePath }), id: 'id-1', retryCount: 0 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    const FileSystem = require('expo-file-system/legacy');
    await markUploadComplete('id-1');

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(filePath, { idempotent: true });
  });

  it('handles non-existent file gracefully', async () => {
    const queue = [
      {
        ...makeEntry({ filePath: '/mock/docs/pending_uploads/missing.fit' }),
        id: 'id-1',
        retryCount: 0,
      },
    ];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    // Should not throw even if file does not exist
    await expect(markUploadComplete('id-1')).resolves.not.toThrow();
  });

  it('handles unknown id gracefully (no entry found)', async () => {
    const queue = [{ ...makeEntry(), id: 'id-1', retryCount: 0 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadComplete('unknown-id');

    // Queue should remain the same length (no matching entry removed)
    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue).toHaveLength(1);
  });
});

describe('markUploadFailed', () => {
  it('increments retryCount on first failure', async () => {
    const queue = [{ ...makeEntry(), id: 'id-1', retryCount: 0 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadFailed('id-1', 'Network error');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue[0].retryCount).toBe(1);
    expect(updatedQueue[0].lastError).toBe('Network error');
  });

  it('increments retryCount on successive failures', async () => {
    const queue = [{ ...makeEntry(), id: 'id-1', retryCount: 3 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadFailed('id-1', 'Timeout');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue[0].retryCount).toBe(4);
    expect(updatedQueue[0].lastError).toBe('Timeout');
  });

  it('removes entry after reaching MAX_RETRIES (5)', async () => {
    const queue = [
      { ...makeEntry(), id: 'id-1', retryCount: 4 },
      { ...makeEntry({ name: 'Other' }), id: 'id-2', retryCount: 0 },
    ];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadFailed('id-1', 'Server error');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue).toHaveLength(1);
    expect(updatedQueue[0].id).toBe('id-2');
  });

  it('cleans up file when max retries exceeded', async () => {
    const filePath = '/mock/docs/pending_uploads/test.fit';
    mockFileStore.set(filePath, 'file-content');
    const queue = [{ ...makeEntry({ filePath }), id: 'id-1', retryCount: 4 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    const FileSystem = require('expo-file-system/legacy');
    await markUploadFailed('id-1', 'Final failure');

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith(filePath, { idempotent: true });
  });

  it('does not remove entry at retryCount 3 (one before max)', async () => {
    const queue = [{ ...makeEntry(), id: 'id-1', retryCount: 3 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadFailed('id-1', 'Timeout');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue).toHaveLength(1);
    expect(updatedQueue[0].retryCount).toBe(4);
  });

  it('does not modify other entries when one fails', async () => {
    const queue = [
      { ...makeEntry({ name: 'Ride 1' }), id: 'id-1', retryCount: 0 },
      { ...makeEntry({ name: 'Ride 2' }), id: 'id-2', retryCount: 2 },
    ];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadFailed('id-1', 'Error');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue[0].retryCount).toBe(1);
    expect(updatedQueue[1].retryCount).toBe(2);
    expect(updatedQueue[1].name).toBe('Ride 2');
  });

  it('handles unknown id without modifying queue', async () => {
    const queue = [{ ...makeEntry(), id: 'id-1', retryCount: 0 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadFailed('unknown-id', 'Error');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue).toHaveLength(1);
    expect(updatedQueue[0].retryCount).toBe(0);
  });
});

describe('getQueueSize', () => {
  it('returns 0 for an empty queue', async () => {
    const size = await getQueueSize();
    expect(size).toBe(0);
  });

  it('returns correct count for populated queue', async () => {
    const queue = [
      { ...makeEntry(), id: 'id-1', retryCount: 0 },
      { ...makeEntry(), id: 'id-2', retryCount: 0 },
      { ...makeEntry(), id: 'id-3', retryCount: 1 },
    ];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    const size = await getQueueSize();
    expect(size).toBe(3);
  });

  it('returns 0 when AsyncStorage contains corrupt data', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue('invalid json');
    const size = await getQueueSize();
    expect(size).toBe(0);
  });
});

describe('clearUploadQueue', () => {
  it('removes the queue key from AsyncStorage', async () => {
    await clearUploadQueue();
    expect(AsyncStorage.removeItem).toHaveBeenCalledWith(QUEUE_KEY);
  });

  it('deletes the uploads directory', async () => {
    mockDirStore.add('/mock/docs/pending_uploads/');
    const FileSystem = require('expo-file-system/legacy');

    await clearUploadQueue();

    expect(FileSystem.deleteAsync).toHaveBeenCalledWith('/mock/docs/pending_uploads/', {
      idempotent: true,
    });
  });

  it('handles missing directory gracefully', async () => {
    // Directory does not exist
    await expect(clearUploadQueue()).resolves.not.toThrow();
  });
});

describe('persistence and edge cases', () => {
  it('handles AsyncStorage returning null (fresh install)', async () => {
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(null);

    const size = await getQueueSize();
    expect(size).toBe(0);

    const entry = await dequeueUpload();
    expect(entry).toBeNull();
  });

  it('queue survives enqueue-dequeue-complete cycle', async () => {
    // Enqueue
    const id = await enqueueUpload(makeEntry({ name: 'Test Ride' }));

    // Simulate persistence: return stored queue on next getItem
    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(storedJson);

    // Dequeue
    const entry = await dequeueUpload();
    expect(entry).not.toBeNull();
    expect(entry!.id).toBe(id);
    expect(entry!.name).toBe('Test Ride');

    // Mark complete
    await markUploadComplete(id);
    const updatedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[1][1];
    const updatedQueue = JSON.parse(updatedJson);
    expect(updatedQueue).toHaveLength(0);
  });

  it('enqueue-fail-retry-complete cycle works correctly', async () => {
    // Enqueue
    const id = await enqueueUpload(makeEntry());
    let storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(storedJson);

    // Fail twice
    await markUploadFailed(id, 'Error 1');
    storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[1][1];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(storedJson);

    await markUploadFailed(id, 'Error 2');
    storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[2][1];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(storedJson);

    // Check state
    const queue = JSON.parse(storedJson);
    expect(queue[0].retryCount).toBe(2);
    expect(queue[0].lastError).toBe('Error 2');

    // Complete successfully
    await markUploadComplete(id);
    storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[3][1];
    const finalQueue = JSON.parse(storedJson);
    expect(finalQueue).toHaveLength(0);
  });

  it('multiple entries maintain FIFO order', async () => {
    // Enqueue 3 entries
    await enqueueUpload(makeEntry({ name: 'First' }));
    let storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(storedJson);

    await enqueueUpload(makeEntry({ name: 'Second' }));
    storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[1][1];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(storedJson);

    await enqueueUpload(makeEntry({ name: 'Third' }));
    storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[2][1];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(storedJson);

    // Dequeue should return first
    const entry = await dequeueUpload();
    expect(entry!.name).toBe('First');
  });

  it('markUploadFailed with retryCount exactly at MAX_RETRIES-1 removes entry', async () => {
    // retryCount is 4, so retryCount + 1 = 5 >= MAX_RETRIES (5) => remove
    const queue = [{ ...makeEntry(), id: 'id-1', retryCount: 4 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadFailed('id-1', 'Final');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue).toHaveLength(0);
  });

  it('markUploadFailed with retryCount well above MAX_RETRIES still removes', async () => {
    const queue = [{ ...makeEntry(), id: 'id-1', retryCount: 10 }];
    (AsyncStorage.getItem as jest.Mock).mockResolvedValue(JSON.stringify(queue));

    await markUploadFailed('id-1', 'Way past max');

    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const updatedQueue = JSON.parse(storedJson);
    expect(updatedQueue).toHaveLength(0);
  });

  it('handles entry with optional pairedEventId', async () => {
    await enqueueUpload(makeEntry({ pairedEventId: 123 }));
    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const queue = JSON.parse(storedJson);
    expect(queue[0].pairedEventId).toBe(123);
  });

  it('handles entry without optional pairedEventId', async () => {
    const entry = makeEntry();
    delete (entry as Record<string, unknown>).pairedEventId;
    await enqueueUpload(entry);
    const storedJson = (AsyncStorage.setItem as jest.Mock).mock.calls[0][1];
    const queue = JSON.parse(storedJson);
    expect(queue[0].pairedEventId).toBeUndefined();
  });
});
