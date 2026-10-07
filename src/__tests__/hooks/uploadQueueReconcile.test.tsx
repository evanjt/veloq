/**
 * Scenario: an upload landed while the engine was closed, so the ride's row
 * never took the id intervals.icu gave it.
 *
 * Expected behaviour: the queue processor replays the write when it mounts,
 * before the next sync window can store the ride a second time, sends any
 * effort an upload could not, and then confirms every landed upload against
 * the server so a ride the app believes is safe is one it has actually read
 * back. Each time the engine opens it also writes the engine row of any ride
 * whose save never got one.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useUploadQueueProcessor } from '@/features/recording/hooks/useUploadQueueProcessor';
import {
  reconcileProvisionalUploads,
  replayProvisionalWrites,
} from '@/features/recording/lib/storage/provisionalActivity';
import { sendOwedRpe } from '@/features/recording/lib/upload/owedRpe';
import {
  migrateLegacyUploadQueue,
  adoptAsyncStorageIndex,
} from '@/features/recording/lib/storage/recordingLibrary';
import { confirmAndDeleteUploaded } from '@/features/recording/lib/upload/confirmUploads';

let mockReady = false;
let mockReadyNonce = 0;
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => ({ ready: mockReady }),
}));
jest.mock('@/features/routes', () => ({
  useEngineStatus: (selector: (s: { readyNonce: number }) => unknown) =>
    selector({ readyNonce: mockReadyNonce }),
}));

jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  reconcileProvisionalUploads: jest.fn(async () => 0),
  replayProvisionalWrites: jest.fn(async () => 0),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  migrateLegacyUploadQueue: jest.fn(async () => {}),
  adoptAsyncStorageIndex: jest.fn(async () => 0),
  wakeUploadSchedule: jest.fn(),
  onUploadPermissionRefused: jest.fn(() => () => {}),
}));

jest.mock('@/features/recording/lib/upload/owedRpe', () => ({
  sendOwedRpe: jest.fn(async () => 0),
}));

jest.mock('@/features/recording/lib/upload/confirmUploads', () => ({
  confirmAndDeleteUploaded: jest.fn(async () => 0),
}));

jest.mock('@/shared/debug/debug', () => ({
  debug: { create: () => ({ log: () => {}, warn: () => {}, error: () => {} }) },
}));

const mockReconcile = reconcileProvisionalUploads as jest.Mock;
const mockConfirm = confirmAndDeleteUploaded as jest.Mock;

beforeEach(() => {
  mockReady = false;
  mockReadyNonce = 0;
  jest.clearAllMocks();
  mockReconcile.mockResolvedValue(0);
  mockConfirm.mockResolvedValue(0);
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

  it('confirms the landed uploads behind the reconcile pass', async () => {
    renderHook(() => useUploadQueueProcessor());

    await waitFor(() => expect(mockConfirm).toHaveBeenCalledTimes(1));
  });

  it('sends an owed effort before the confirmation can delete its recording', async () => {
    const order: string[] = [];
    jest.mocked(sendOwedRpe).mockImplementation(async () => {
      order.push('rpe');
      return 1;
    });
    mockConfirm.mockImplementation(async () => {
      order.push('confirm');
      return 0;
    });
    renderHook(() => useUploadQueueProcessor());

    await waitFor(() => expect(order).toEqual(['rpe', 'confirm']));
  });

  it('does not confirm when the reconcile pass threw, and does not throw either', async () => {
    mockReconcile.mockRejectedValue(new Error('engine closed'));

    expect(() => renderHook(() => useUploadQueueProcessor())).not.toThrow();
    await waitFor(() => expect(mockReconcile).toHaveBeenCalled());
    expect(mockConfirm).not.toHaveBeenCalled();
  });
});

it('adopts legacy recordings when readiness is announced and repeats on a later open', async () => {
  const { rerender } = renderHook(() => useUploadQueueProcessor());
  expect(migrateLegacyUploadQueue).not.toHaveBeenCalled();
  mockReady = true;
  mockReadyNonce++;
  rerender({});
  await waitFor(() => expect(adoptAsyncStorageIndex).toHaveBeenCalledTimes(1));
  expect(migrateLegacyUploadQueue).toHaveBeenCalledTimes(1);
  mockReadyNonce++;
  rerender({});
  await waitFor(() => expect(adoptAsyncStorageIndex).toHaveBeenCalledTimes(2));
});

it('writes the engine rows a save missed each time the engine opens, after adoption', async () => {
  const order: string[] = [];
  jest.mocked(adoptAsyncStorageIndex).mockImplementation(async () => {
    order.push('adopt');
    return 0;
  });
  jest.mocked(replayProvisionalWrites).mockImplementation(async () => {
    order.push('replay');
    return 0;
  });
  const { rerender } = renderHook(() => useUploadQueueProcessor());
  expect(replayProvisionalWrites).not.toHaveBeenCalled();
  mockReady = true;
  mockReadyNonce++;
  rerender({});
  await waitFor(() => expect(order).toEqual(['adopt', 'replay']));
  mockReadyNonce++;
  rerender({});
  await waitFor(() => expect(replayProvisionalWrites).toHaveBeenCalledTimes(2));
});
