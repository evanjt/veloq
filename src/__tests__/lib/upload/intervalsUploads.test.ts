/**
 * Scenario: a recording, or a manual entry, is handed to the write seam above
 * the engine.
 *
 * Expected behaviour: the FIT goes up as a path rather than as bytes, the
 * optional title and calendar link travel with it, a refused write throws with
 * the outcome the queue branches on, and demo mode never reaches the network.
 * The multipart field names and the `Veloq` device tag are asserted in Rust,
 * where the body is actually built.
 */

jest.mock('veloqrs', () => ({
  routeEngine: {
    uploadActivityFile: jest.fn(),
    createManualActivity: jest.fn(),
  },
}));

const mockAuthState = { isDemoMode: false, athleteId: 'i12345' };

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: { getState: () => mockAuthState },
  DEMO_ATHLETE_ID: 'demo',
}));

import { routeEngine } from 'veloqrs';
import {
  uploadActivityFile,
  createManualActivity,
  UploadFailure,
} from '@/features/recording/lib/upload/intervalsUploads';
import type { ManualActivityData } from '@/types';

const mockUploadActivityFile = routeEngine.uploadActivityFile as jest.Mock;
const mockCreateManualActivity = routeEngine.createManualActivity as jest.Mock;

const OK = { kind: 'ok', id: 'i999', message: 'ok' };

beforeEach(() => {
  jest.clearAllMocks();
  mockAuthState.isDemoMode = false;
  mockAuthState.athleteId = 'i12345';
  mockUploadActivityFile.mockResolvedValue(OK);
  mockCreateManualActivity.mockResolvedValue(OK);
});

describe('uploadActivityFile', () => {
  it('hands the engine the path on disk, not the bytes', async () => {
    const id = await uploadActivityFile('file:///recordings/rec-1.fit', 'Morning Ride.fit');

    expect(mockUploadActivityFile).toHaveBeenCalledWith(
      'file:///recordings/rec-1.fit',
      'Morning Ride.fit',
      undefined,
      undefined
    );
    expect(id).toBe('i999');
  });

  it('forwards the activity name and the paired event when supplied', async () => {
    await uploadActivityFile('file:///recordings/rec-1.fit', 'Morning Ride.fit', {
      name: 'Bern loop',
      pairedEventId: 4321,
    });

    expect(mockUploadActivityFile).toHaveBeenCalledWith(
      'file:///recordings/rec-1.fit',
      'Morning Ride.fit',
      'Bern loop',
      4321
    );
  });

  it('accepts a success the server did not put an id on', async () => {
    // The activity is already upstream. Failing here would upload it twice.
    mockUploadActivityFile.mockResolvedValue({ kind: 'ok', message: 'ok' });

    await expect(
      uploadActivityFile('file:///recordings/rec-1.fit', 'ride.fit')
    ).resolves.toBeUndefined();
  });

  it('throws with the outcome attached when the write is refused', async () => {
    mockUploadActivityFile.mockResolvedValue({
      kind: 'http',
      status: 403,
      detail: 'No permission',
      message: 'HTTP 403: No permission',
    });

    const thrown = await uploadActivityFile('file:///recordings/rec-1.fit', 'ride.fit').then(
      () => null,
      (e: unknown) => e as UploadFailure
    );
    expect(thrown).toBeInstanceOf(UploadFailure);
    expect(thrown?.outcome.status).toBe(403);
    expect(thrown?.message).toBe('HTTP 403: No permission');
  });

  it('acknowledges the upload locally in demo mode without touching the engine', async () => {
    mockAuthState.isDemoMode = true;

    const id = await uploadActivityFile('file:///recordings/rec-1.fit', 'ride.fit');

    expect(id).toMatch(/^demo-\d+$/);
    expect(mockUploadActivityFile).not.toHaveBeenCalled();
  });
});

describe('createManualActivity', () => {
  const ENTRY: ManualActivityData = {
    type: 'WeightTraining',
    name: 'Gym',
    start_date_local: '2026-08-05T18:00:00',
    elapsed_time: 3600,
    average_heartrate: 112,
  };

  it('widens the screen shape to the record the engine takes', async () => {
    await createManualActivity(ENTRY);

    expect(mockCreateManualActivity).toHaveBeenCalledWith({
      activityType: 'WeightTraining',
      name: 'Gym',
      startDateLocal: '2026-08-05T18:00:00',
      elapsedTime: 3600n,
      movingTime: undefined,
      distance: undefined,
      totalElevationGain: undefined,
      averageHeartrate: 112,
      description: undefined,
      trainer: undefined,
      commute: undefined,
    });
  });

  it('passes the flags through when the screen set them', async () => {
    await createManualActivity({ ...ENTRY, trainer: true, commute: false, moving_time: 3000 });

    const [sent] = mockCreateManualActivity.mock.calls[0];
    expect(sent.trainer).toBe(true);
    expect(sent.commute).toBe(false);
    expect(sent.movingTime).toBe(3000n);
  });

  it('throws with the outcome attached when the entry is refused', async () => {
    mockCreateManualActivity.mockResolvedValue({
      kind: 'http',
      status: 400,
      detail: 'Bad request',
      message: 'HTTP 400: Bad request',
    });

    await expect(createManualActivity(ENTRY)).rejects.toBeInstanceOf(UploadFailure);
  });

  it('acknowledges the entry locally in demo mode', async () => {
    mockAuthState.athleteId = 'demo';

    const id = await createManualActivity(ENTRY);

    expect(id).toMatch(/^demo-\d+$/);
    expect(mockCreateManualActivity).not.toHaveBeenCalled();
  });
});
