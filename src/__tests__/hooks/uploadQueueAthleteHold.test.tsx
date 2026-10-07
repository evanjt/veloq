/**
 * Scenario: a 401 signs the phone out with rides still queued, they are held
 * rather than demoted, and someone else signs in on the same phone.
 *
 * Expected behaviour: the queue holds every ride that athlete did not record
 * as soon as they are signed in, and holds nothing while nobody is.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useUploadQueueProcessor } from '@/features/recording/hooks/useUploadQueueProcessor';
import {
  holdRecordingsOfOtherAthletes,
  wakeUploadSchedule,
} from '@/features/recording/lib/storage/recordingLibrary';

let mockAthleteId: string | null = 'i296629';

jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => ({ ready: true }),
}));
jest.mock('@/features/routes', () => ({
  useEngineStatus: (selector: (s: { readyNonce: number }) => unknown) =>
    selector({ readyNonce: 1 }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { athleteId: string | null }) => unknown) =>
    selector({ athleteId: mockAthleteId }),
}));

jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  reconcileProvisionalUploads: jest.fn(async () => 0),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  migrateLegacyUploadQueue: jest.fn(async () => {}),
  adoptAsyncStorageIndex: jest.fn(async () => 0),
  holdRecordingsOfOtherAthletes: jest.fn(async () => 0),
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

const mockHold = holdRecordingsOfOtherAthletes as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAthleteId = 'i296629';
  mockHold.mockResolvedValue(0);
});

describe('the queue and the athlete signed in', () => {
  it('holds what the signed-in athlete did not record', async () => {
    renderHook(() => useUploadQueueProcessor());

    await waitFor(() => expect(mockHold).toHaveBeenCalledWith('i296629'));
  });

  it('holds again for whoever signs in next', async () => {
    const { rerender } = renderHook(() => useUploadQueueProcessor());
    await waitFor(() => expect(mockHold).toHaveBeenCalledWith('i296629'));

    mockAthleteId = 'i400';
    rerender({});

    await waitFor(() => expect(mockHold).toHaveBeenLastCalledWith('i400'));
    expect(mockHold).toHaveBeenCalledTimes(2);
  });

  it('holds nothing when nobody is signed in, which is not a decision it can take', async () => {
    mockAthleteId = null;
    renderHook(() => useUploadQueueProcessor());

    await waitFor(() => expect(wakeUploadSchedule).toHaveBeenCalled());
    expect(mockHold).not.toHaveBeenCalled();
  });
});
