/**
 * Scenario: a 401 signs the phone out with rides still queued, they are held
 * rather than demoted, and someone else signs in on the same phone.
 *
 * Expected behaviour: the queue holds every ride that athlete did not record
 * before it drains anything, and a drain that meets a refused credential stops
 * instead of walking the rest of the queue into the same 401.
 */

import { renderHook, waitFor } from '@testing-library/react-native';

import { useUploadQueueProcessor } from '@/features/recording/hooks/useUploadQueueProcessor';
import {
  nextPendingUpload,
  holdRecordingsOfOtherAthletes,
} from '@/features/recording/lib/storage/recordingLibrary';
import { uploadRecording } from '@/features/recording/lib/upload/uploadRecording';

let mockAthleteId: string | null = 'i296629';

jest.mock('@/shared/app/NetworkContext', () => ({
  useNetwork: () => ({ isOnline: true }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { athleteId: string | null }) => unknown) =>
    selector({ athleteId: mockAthleteId }),
}));

jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  reconcileProvisionalUploads: jest.fn(async () => 0),
}));

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  nextPendingUpload: jest.fn(async () => null),
  migrateLegacyUploadQueue: jest.fn(async () => {}),
  adoptAsyncStorageIndex: jest.fn(async () => 0),
  holdRecordingsOfOtherAthletes: jest.fn(async () => 0),
}));

jest.mock('@/features/recording/lib/upload/uploadRecording', () => ({
  uploadRecording: jest.fn(),
}));

jest.mock('@/features/recording/lib/upload/confirmUploads', () => ({
  confirmAndDeleteUploaded: jest.fn(async () => 0),
}));

jest.mock('@/shared/debug/debug', () => ({
  debug: { create: () => ({ log: () => {}, warn: () => {}, error: () => {} }) },
}));

const mockNextPending = nextPendingUpload as jest.Mock;
const mockHold = holdRecordingsOfOtherAthletes as jest.Mock;
const mockUpload = uploadRecording as jest.Mock;

const ENTRY = { id: 'rec-1', name: 'Morning Ride' };

beforeEach(() => {
  jest.clearAllMocks();
  mockAthleteId = 'i296629';
  mockNextPending.mockResolvedValue(null);
  mockHold.mockResolvedValue(0);
});

describe('the queue and the athlete signed in', () => {
  it('holds what the signed-in athlete did not record', async () => {
    renderHook(() => useUploadQueueProcessor());

    await waitFor(() => expect(mockHold).toHaveBeenCalledWith('i296629'));
  });

  it('holds nothing when nobody is signed in, which is not a decision it can take', async () => {
    mockAthleteId = null;
    renderHook(() => useUploadQueueProcessor());

    await waitFor(() => expect(mockNextPending).toHaveBeenCalled());
    expect(mockHold).not.toHaveBeenCalled();
  });

  it('stops the drain on a refused credential rather than spending the queue on it', async () => {
    mockNextPending.mockResolvedValue(ENTRY);
    mockUpload.mockResolvedValue({ outcome: 'authExpired' });

    renderHook(() => useUploadQueueProcessor());

    await waitFor(() => expect(mockUpload).toHaveBeenCalledTimes(1));
    expect(mockUpload).toHaveBeenCalledTimes(1);
  });
});
