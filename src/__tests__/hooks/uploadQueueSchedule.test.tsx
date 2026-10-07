/**
 * Scenario: a ride is saved offline and connectivity returns while the app is
 * in the background.
 *
 * Expected behaviour: the engine owns the schedule and drains the queue
 * itself. The hook starts the schedule when the engine opens and not before,
 * wakes it again when write permission is granted, and reads no pending ride:
 * not on mount, not on a foreground, not on a timer. A refusal for want of
 * write permission, which the engine announces, marks the athlete as lacking
 * it.
 */

import { act, renderHook } from '@testing-library/react-native';
import { AppState } from 'react-native';

import { useUploadQueueProcessor } from '@/features/recording/hooks/useUploadQueueProcessor';
import {
  listRecordings,
  wakeUploadSchedule,
} from '@/features/recording/lib/storage/recordingLibrary';

let mockRefused: (() => void) | null = null;
let mockNeedsUpgrade = true;
let mockReady = true;
let mockReadyNonce = 1;
const mockSetHasWritePermission = jest.fn();

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => ({ ready: mockReady }),
}));
jest.mock('@/features/routes', () => ({
  useEngineStatus: (selector: (s: { readyNonce: number }) => unknown) =>
    selector({ readyNonce: mockReadyNonce }),
}));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { athleteId: string | null }) => unknown) =>
    selector({ athleteId: 'i1' }),
}));
jest.mock('@/features/recording/stores/UploadPermissionStore', () => ({
  useUploadPermissionStore: Object.assign(
    (selector: (s: { needsUpgrade: boolean }) => unknown) =>
      selector({ needsUpgrade: mockNeedsUpgrade }),
    { getState: () => ({ setHasWritePermission: mockSetHasWritePermission }) }
  ),
}));
jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  reconcileProvisionalUploads: jest.fn(async () => 0),
  replayProvisionalWrites: jest.fn(async () => 0),
}));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  listRecordings: jest.fn(async () => []),
  migrateLegacyUploadQueue: jest.fn(async () => {}),
  adoptAsyncStorageIndex: jest.fn(async () => 0),
  holdRecordingsOfOtherAthletes: jest.fn(async () => 0),
  wakeUploadSchedule: jest.fn(),
  onUploadPermissionRefused: jest.fn((cb: () => void) => {
    mockRefused = cb;
    return () => {
      mockRefused = null;
    };
  }),
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

const mockWake = wakeUploadSchedule as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  jest.useRealTimers();
  mockRefused = null;
  mockNeedsUpgrade = true;
  mockReady = true;
  mockReadyNonce = 1;
});

describe('the upload schedule', () => {
  it('starts the engine schedule when the engine is ready, and not before', () => {
    mockReady = false;
    const { rerender, unmount } = renderHook(() => useUploadQueueProcessor());
    expect(mockWake).not.toHaveBeenCalled();
    expect(mockRefused).toBeNull();

    mockReady = true;
    rerender({});
    expect(mockWake).toHaveBeenCalledTimes(1);
    expect(mockRefused).not.toBeNull();

    unmount();
    expect(mockRefused).toBeNull();
  });

  it('wakes the schedule again on each engine open', () => {
    const { rerender } = renderHook(() => useUploadQueueProcessor());
    mockWake.mockClear();

    mockReadyNonce++;
    rerender({});

    expect(mockWake).toHaveBeenCalled();
  });

  it('wakes the schedule when write permission is granted', () => {
    const { rerender } = renderHook(() => useUploadQueueProcessor());
    mockWake.mockClear();

    mockNeedsUpgrade = false;
    rerender({});

    expect(mockWake).toHaveBeenCalledTimes(1);
  });

  it('does not wake on a granted permission while the engine is closed', () => {
    mockReady = false;
    mockNeedsUpgrade = false;
    renderHook(() => useUploadQueueProcessor());

    expect(mockWake).not.toHaveBeenCalled();
  });

  it('marks the athlete as lacking write permission when the engine reports a refusal', () => {
    renderHook(() => useUploadQueueProcessor());
    expect(mockSetHasWritePermission).not.toHaveBeenCalled();

    act(() => mockRefused?.());

    expect(mockSetHasWritePermission).toHaveBeenCalledTimes(1);
    expect(mockSetHasWritePermission).toHaveBeenCalledWith(false);
  });

  it('does not drain anything itself: no foreground listener, no timer, no pending read', () => {
    jest.useFakeTimers();
    const addEventListener = jest.spyOn(AppState, 'addEventListener');
    renderHook(() => useUploadQueueProcessor());

    jest.advanceTimersByTime(60 * 60 * 1000);

    expect(addEventListener).not.toHaveBeenCalled();
    expect(jest.getTimerCount()).toBe(0);
    expect(listRecordings).not.toHaveBeenCalled();
    addEventListener.mockRestore();
  });
});
