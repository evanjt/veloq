/**
 * Scenario: the review save or Upload now hands a recording to the write seam
 * above the engine.
 *
 * Expected behaviour: the recording goes to the engine's one upload command by
 * id, as the athlete's own request, and the screen gets the engine's answer
 * back as it was given. Demo mode has nowhere to send a ride, so nothing
 * starts and nothing is written. The sequence itself, every transition and every
 * request, is asserted in Rust, where it runs.
 */

import { FfiUploadOutcome, recordings } from 'veloqrs';
import { uploadRecordingNow } from '@/features/recording/lib/upload/intervalsUploads';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    recordings: {
      uploadRecording: jest.fn(),
    },
  })
);

const mockAuthState = { isDemoMode: false, athleteId: 'i12345' };

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => mockAuthState },
  DEMO_ATHLETE_ID: 'demo',
}));

const mockUploadRecording = recordings.uploadRecording as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState.isDemoMode = false;
  mockAuthState.athleteId = 'i12345';
  mockUploadRecording.mockResolvedValue({ outcome: FfiUploadOutcome.Uploaded });
});

describe('uploadRecordingNow', () => {
  vaultIt(
    "hands the engine the ride's id as the athlete's own request, with the live documents directory",
    async () => {
      await uploadRecordingNow('rec-1');

      expect(mockUploadRecording).toHaveBeenCalledWith('rec-1', true, 'file:///docs/');
    }
  );

  vaultIt("answers the engine's outcome and detail as they were given", async () => {
    mockUploadRecording.mockResolvedValue({
      outcome: FfiUploadOutcome.Rejected,
      errorDetail: 'File type not supported',
    });

    expect(await uploadRecordingNow('rec-1')).toEqual({
      outcome: FfiUploadOutcome.Rejected,
      errorDetail: 'File type not supported',
    });
  });

  it('answers that nothing started in demo mode, never touching the engine', async () => {
    mockAuthState.isDemoMode = true;
    mockAuthState.athleteId = 'demo';

    const result = await uploadRecordingNow('rec-1');

    expect(result).toEqual({ outcome: FfiUploadOutcome.NotStarted });
    expect(mockUploadRecording).not.toHaveBeenCalled();
  });

  vaultIt('answers that nothing started for the demo athlete without the demo flag', async () => {
    mockAuthState.athleteId = 'demo';

    expect(await uploadRecordingNow('rec-1')).toEqual({ outcome: FfiUploadOutcome.NotStarted });
  });
});
