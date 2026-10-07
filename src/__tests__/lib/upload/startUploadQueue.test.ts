/**
 * Scenario: the engine opens at launch, and again after a retry or a re-auth,
 * with nothing on the JavaScript side mounted to drive the upload queue.
 *
 * Expected behaviour: each open adopts the old queue and index and then writes
 * the engine rows a save missed, in that order, and wakes the engine's
 * schedule, which uploads and sweeps on its own. The engine's announcement
 * that write permission was refused marks the athlete as lacking it, and is
 * heard once however many times the engine opens. A failure in any of it is
 * logged and never reaches launch.
 */

import { startUploadQueue } from '@/features/recording/lib/upload/startUploadQueue';
import {
  adoptAsyncStorageIndex,
  listRecordings,
  migrateLegacyUploadQueue,
  wakeUploadSchedule,
} from '@/features/recording/lib/storage/recordingLibrary';
import { replayProvisionalWrites } from '@/features/recording/lib/storage/provisionalActivity';

const mockRefusalListeners = new Set<() => void>();
const mockSetHasWritePermission = jest.fn();

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  listRecordings: jest.fn(async () => []),
  migrateLegacyUploadQueue: jest.fn(async () => {}),
  adoptAsyncStorageIndex: jest.fn(async () => 0),
  wakeUploadSchedule: jest.fn(),
  onUploadPermissionRefused: jest.fn((listener: () => void) => {
    mockRefusalListeners.add(listener);
    return () => mockRefusalListeners.delete(listener);
  }),
}));
jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  replayProvisionalWrites: jest.fn(async () => 0),
}));
jest.mock('@/features/recording/stores/UploadPermissionStore', () => ({
  useUploadPermissionStore: {
    getState: () => ({ setHasWritePermission: mockSetHasWritePermission }),
  },
}));
jest.mock('@/shared/debug/debug', () => ({
  debug: { create: () => ({ log: () => {}, warn: () => {}, error: () => {} }) },
}));

beforeEach(() => {
  jest.clearAllMocks();
});

it('adopts the old queue and index, then writes the rows a save missed', async () => {
  const order: string[] = [];
  jest.mocked(migrateLegacyUploadQueue).mockImplementation(async () => {
    order.push('queue');
  });
  jest.mocked(adoptAsyncStorageIndex).mockImplementation(async () => {
    order.push('index');
    return 0;
  });
  jest.mocked(replayProvisionalWrites).mockImplementation(async () => {
    order.push('replay');
    return 0;
  });

  await startUploadQueue();

  expect(order).toEqual(['queue', 'index', 'replay']);
});

it('repeats the adoption and wakes the schedule on every engine open', async () => {
  await startUploadQueue();
  await startUploadQueue();

  expect(adoptAsyncStorageIndex).toHaveBeenCalledTimes(2);
  expect(replayProvisionalWrites).toHaveBeenCalledTimes(2);
  expect(wakeUploadSchedule).toHaveBeenCalledTimes(2);
});

it('hears a refused write permission once, however many times the engine opens', async () => {
  await startUploadQueue();
  await startUploadQueue();

  for (const listener of mockRefusalListeners) listener();

  expect(mockRefusalListeners.size).toBe(1);
  expect(mockSetHasWritePermission).toHaveBeenCalledTimes(1);
  expect(mockSetHasWritePermission).toHaveBeenCalledWith(false);
});

it('wakes the schedule even when the adoption fails, and does not throw', async () => {
  jest.mocked(migrateLegacyUploadQueue).mockRejectedValueOnce(new Error('storage'));

  await expect(startUploadQueue()).resolves.toBeUndefined();

  expect(wakeUploadSchedule).toHaveBeenCalledTimes(1);
  expect(replayProvisionalWrites).not.toHaveBeenCalled();
});

it('does not throw when the engine refuses the wake', async () => {
  jest.mocked(wakeUploadSchedule).mockImplementationOnce(() => {
    throw new Error('Engine not initialized');
  });

  await expect(startUploadQueue()).resolves.toBeUndefined();

  expect(replayProvisionalWrites).toHaveBeenCalledTimes(1);
});

it('reads no recording itself: the engine sweeps what has landed', async () => {
  await startUploadQueue();

  expect(listRecordings).not.toHaveBeenCalled();
});
