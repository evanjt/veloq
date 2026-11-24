/**
 * Scenario: a ride leaves its route and the notification update that would carry the vibration
 * request is not posted: the module throws, or the ride has no notification to post.
 *
 * Expected behaviour: the request stays pending and rides the next posted update; once an
 * update carrying it is posted, it is not sent again.
 */

import { FfiFollowDirection, FfiFollowStatus, type FfiRouteFollow } from 'veloqrs';

import { sessionGuidanceCue } from '@/features/recording/lib/guidanceCue';
import { updateRecordingNotification } from '@/features/recording/lib/recordingNotification';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const mockUpdate = jest.fn();

jest.mock('expo-modules-core', () => ({
  ...jest.requireActual('expo-modules-core'),
  requireOptionalNativeModule: (name: string) =>
    name === 'VeloqRecordingNotification'
      ? {
          update: (...a: unknown[]) => mockUpdate(...a),
          clear: jest.fn(),
          serviceRunning: () => true,
        }
      : null,
}));

const offRoute: FfiRouteFollow = {
  alongM: 500,
  remainingM: 1500,
  crossTrackM: 140,
  routeBearingDeg: 0,
  bearingToRouteDeg: 0,
  status: FfiFollowStatus.OffRoute,
  direction: FfiFollowDirection.Forward,
};

const vibrates = (call: number) => JSON.parse(mockUpdate.mock.calls[call][0] as string).vibrate;

describe('the off-route vibration request', () => {
  beforeEach(() => {
    mockUpdate.mockReset();
    sessionGuidanceCue.reset();
    useRecordingStore.getState().reset();
  });

  it('survives an update the module failed to post, and is sent once after', () => {
    useRecordingStore.getState().startRecording('Ride', 'gps');
    sessionGuidanceCue.observe(offRoute);

    mockUpdate.mockImplementationOnce(() => {
      throw new Error('service gone');
    });
    updateRecordingNotification();
    updateRecordingNotification();
    updateRecordingNotification();

    expect(mockUpdate).toHaveBeenCalledTimes(3);
    expect(vibrates(1)).toBe(true);
    expect(vibrates(2)).toBe(false);
  });

  it('survives an update with no payload to post', () => {
    sessionGuidanceCue.observe(offRoute);
    updateRecordingNotification();
    expect(mockUpdate).not.toHaveBeenCalled();

    useRecordingStore.getState().startRecording('Ride', 'gps');
    updateRecordingNotification();
    expect(vibrates(0)).toBe(true);
  });
});
