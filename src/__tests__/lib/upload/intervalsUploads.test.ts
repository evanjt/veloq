/**
 * Scenario: the review save or Upload now hands a recording to the write seam
 * above the engine.
 *
 * Expected behaviour: the recording goes to the engine's one upload command by
 * id, as the athlete's own request, and the screen gets the engine's answer
 * back as it was given. Demo mode never reaches the engine: the ride is marked
 * uploaded under a local id. The sequence itself, every transition and every
 * request, is asserted in Rust, where it runs.
 */

import { UploadOutcome, engine } from 'veloqrs';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';
import {
  recordingInstall,
  transitionRecording,
} from '@/features/recording/lib/storage/recordingLibrary';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    engine: {
      uploadRecording: jest.fn(),
    },
  })
);

jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  recordingInstall: jest.fn(() => 4),
  transitionRecording: jest.fn(),
}));

const mockAuthState = { isDemoMode: false, athleteId: 'i12345' };

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => mockAuthState },
  DEMO_ATHLETE_ID: 'demo',
}));

const mockUploadRecording = engine.uploadRecording as jest.Mock;
const mockTransition = transitionRecording as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState.isDemoMode = false;
  mockAuthState.athleteId = 'i12345';
  mockUploadRecording.mockResolvedValue({ outcome: UploadOutcome.Uploaded });
  mockTransition.mockResolvedValue({ applied: true, retryCount: 0, install: 4 });
});

describe('uploadRecordingNow', () => {
  it("hands the engine the ride's id as the athlete's own request", async () => {
    await uploadRecordingNow('rec-1');

    expect(mockUploadRecording).toHaveBeenCalledWith('rec-1', true);
  });

  it("answers the engine's outcome and detail as they were given", async () => {
    mockUploadRecording.mockResolvedValue({
      outcome: UploadOutcome.Rejected,
      errorDetail: 'File type not supported',
    });

    expect(await uploadRecordingNow('rec-1')).toEqual({
      outcome: UploadOutcome.Rejected,
      errorDetail: 'File type not supported',
    });
  });

  it('marks the ride uploaded locally in demo mode without touching the engine', async () => {
    mockAuthState.isDemoMode = true;
    mockAuthState.athleteId = 'demo';

    const result = await uploadRecordingNow('rec-1');

    expect(result).toEqual({ outcome: UploadOutcome.Uploaded });
    expect(mockUploadRecording).not.toHaveBeenCalled();
    expect(mockTransition).toHaveBeenCalledWith('rec-1', {
      kind: 'uploaded',
      install: recordingInstall(),
      intervalsActivityId: expect.stringMatching(/^demo-\d+$/),
    });
  });

  it('answers that nothing started when demo mode finds the ride already settled', async () => {
    mockAuthState.athleteId = 'demo';
    mockTransition.mockResolvedValue({ applied: false, retryCount: 0, install: 4 });

    expect(await uploadRecordingNow('rec-1')).toEqual({ outcome: UploadOutcome.NotStarted });
  });
});
