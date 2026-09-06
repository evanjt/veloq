/**
 * Scenario: an upload landed while the engine was closed, so the ride's row
 * never took the id intervals.icu gave it.
 *
 * Expected behaviour: the queue processor replays the write when it mounts,
 * before the next sync window can store the ride a second time.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useUploadQueueProcessor } from '@/features/recording/hooks/useUploadQueueProcessor';
import { reconcileProvisionalUploads } from '@/features/recording/lib/storage/provisionalActivity';
import { nextPendingUpload } from '@/features/recording/lib/storage/recordingLibrary';

jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: false }),
}));

jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  reconcileProvisionalUploads: jest.fn(async () => 0),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  nextPendingUpload: jest.fn(async () => null),
  migrateLegacyUploadQueue: jest.fn(async () => {}),
}));

jest.mock('@/features/recording/lib/upload/uploadRecording', () => ({
  uploadRecording: jest.fn(),
}));

jest.mock('@/shared/debug/debug', () => ({
  debug: { create: () => ({ log: () => {}, warn: () => {}, error: () => {} }) },
}));

const mockReconcile = reconcileProvisionalUploads as jest.Mock;
const mockNextPending = nextPendingUpload as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockReconcile.mockResolvedValue(0);
  mockNextPending.mockResolvedValue(null);
});

describe('useUploadQueueProcessor', () => {
  it('replays the reconcile pass on mount', async () => {
    renderHook(() => useUploadQueueProcessor());

    await waitFor(() => expect(mockReconcile).toHaveBeenCalledTimes(1));
  });

  it('runs it once, not on every render', async () => {
    const { rerender } = renderHook(() => useUploadQueueProcessor());
    rerender({});
    rerender({});

    await waitFor(() => expect(mockReconcile).toHaveBeenCalledTimes(1));
  });

  it('survives a reconcile pass that throws', async () => {
    mockReconcile.mockRejectedValue(new Error('engine closed'));

    expect(() => renderHook(() => useUploadQueueProcessor())).not.toThrow();
    await waitFor(() => expect(mockReconcile).toHaveBeenCalled());
  });
});
