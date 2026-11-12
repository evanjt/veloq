/**
 * Scenario: a rider follows a saved route with the screen off, where the only surfaces are the
 * ride notification and the Live Activity.
 *
 * Expected behaviour: a fix delivered by the background task advances the route follower; going
 * off route puts one line on both surfaces and asks for one vibration, however many fixes stay
 * off route; returning clears the line; a ride that has not joined the route says nothing.
 */

import { FfiFollowDirection, FfiFollowStatus, type FfiRouteFollow } from 'veloqrs';

import { createGuidanceCue } from '@/features/recording/lib/guidanceCue';
import { followRouteOnFixes } from '@/features/recording/lib/routeFollowing';
import { buildRecordingNotificationPayload } from '@/features/recording/lib/recordingNotification';
import {
  CONTENT_STATE_MAX_BYTES,
  buildContentState,
  contentStateBytes,
} from '@/features/recording/lib/liveActivity/contentState';
import { useRecordingLiveStore } from '@/features/recording/stores/RecordingLiveStore';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { handleBackgroundLocations } from '@/features/recording/lib/backgroundLocation';

const mockAdvance = jest.fn();

jest.mock('veloqrs', () => ({
  ...require('../__shared__/veloqrsStub'),
  routes: { advanceRouteFollower: (...args: unknown[]) => mockAdvance(...args) },
}));

jest.mock('@/features/recording/lib/recordingNotification', () => ({
  ...jest.requireActual('@/features/recording/lib/recordingNotification'),
  updateRecordingNotification: jest.fn(),
  installRecordingNotificationActions: jest.fn(() => jest.fn()),
  nameRecordingChannel: jest.fn(),
  locationServiceRunning: jest.fn(async () => true),
}));

const NOW = 1_700_000_000_000;

const record = (
  status: FfiFollowStatus,
  crossTrackM = 0,
  overrides: Partial<FfiRouteFollow> = {}
): FfiRouteFollow => ({
  alongM: 500,
  remainingM: 1500,
  crossTrackM,
  routeBearingDeg: 0,
  bearingToRouteDeg: 0,
  status,
  direction: FfiFollowDirection.Forward,
  ...overrides,
});

const describeOff = (g: FfiRouteFollow) => `Off route · ${Math.round(g.crossTrackM)} m`;

describe('createGuidanceCue', () => {
  it('puts a line and one vibration on the move into off route, and holds both for later off-route fixes', () => {
    const cue = createGuidanceCue(describeOff);

    expect(cue.observe(record(FfiFollowStatus.OnRoute, 3))).toEqual({
      line: null,
      vibrate: false,
      changed: false,
    });
    expect(cue.observe(record(FfiFollowStatus.OffRoute, 140))).toEqual({
      line: 'Off route · 140 m',
      vibrate: true,
      changed: true,
    });
    // The distance grows, but the line is only rewritten on a state change.
    expect(cue.observe(record(FfiFollowStatus.OffRoute, 160))).toEqual({
      line: 'Off route · 140 m',
      vibrate: false,
      changed: false,
    });
  });

  it('clears the line on return and vibrates again for the next departure', () => {
    const cue = createGuidanceCue(describeOff);
    cue.observe(record(FfiFollowStatus.OffRoute, 140));

    expect(cue.observe(record(FfiFollowStatus.OnRoute, 4))).toEqual({
      line: null,
      vibrate: false,
      changed: true,
    });
    expect(cue.observe(record(FfiFollowStatus.OffRoute, 90)).vibrate).toBe(true);
  });

  it('says nothing before the ride has joined the route, or with no guidance', () => {
    const cue = createGuidanceCue(describeOff);

    expect(cue.observe(record(FfiFollowStatus.NotJoined, 800))).toEqual({
      line: null,
      vibrate: false,
      changed: false,
    });
    expect(cue.observe(null).changed).toBe(false);
  });

  it('clears when guidance is dropped while off route', () => {
    const cue = createGuidanceCue(describeOff);
    cue.observe(record(FfiFollowStatus.OffRoute, 140));

    expect(cue.observe(null)).toEqual({ line: null, vibrate: false, changed: true });
  });
});

describe('the surfaces carry the line', () => {
  const state = {
    ...useRecordingStore.getState(),
    status: 'recording',
    activityType: 'Ride',
    startTime: NOW - 600_000,
    pausedDuration: 0,
    _pauseStart: null,
    streams: {
      ...useRecordingStore.getState().streams,
      time: [0, 600],
      latlng: [
        [47.5, 8.5],
        [47.51, 8.51],
      ],
      distance: [0, 4000],
    },
  } as never;
  const options = { translate: (_k: string, f: string) => f, isMetric: true, now: NOW };

  it('puts the line and the vibration request on the notification payload', () => {
    const payload = buildRecordingNotificationPayload(state, {
      ...options,
      guidance: { line: 'Off route · 140 m', vibrate: true },
    });
    expect(payload?.guidance).toBe('Off route · 140 m');
    expect(payload?.vibrate).toBe(true);
  });

  it('puts neither on a payload with no guidance', () => {
    const payload = buildRecordingNotificationPayload(state, options);
    expect(payload?.guidance).toBeNull();
    expect(payload?.vibrate).toBe(false);
  });

  it('keeps the Live Activity state under the cap with the line and a 60-point trace', () => {
    const gps = Array.from({ length: 60 }, (_, i) => ({
      latitude: 47.5 + i * 0.0004,
      longitude: 8.5 + Math.sin(i / 5) * 0.004,
      altitude: null,
      accuracy: 5,
      speed: 8,
      heading: null,
      timestamp: NOW + i * 1000,
    }));
    const built = buildContentState({
      status: 'recording',
      now: NOW,
      movingMs: 600_000,
      distanceLabel: '4.0 km',
      speedLabel: '24 km/h',
      gps,
      guidance: 'Off route · 140 m',
    });
    expect(built.guidance).toBe('Off route · 140 m');
    expect(contentStateBytes(built)).toBeLessThanOrEqual(CONTENT_STATE_MAX_BYTES);
    expect(
      buildContentState({
        status: 'recording',
        now: NOW,
        movingMs: 0,
        distanceLabel: '',
        speedLabel: '',
        gps,
      }).guidance
    ).toBeNull();
  });
});

describe('a fix delivered by the background task', () => {
  it('advances the held follower and keeps the record in the live store', async () => {
    useRecordingLiveStore.getState().reset();
    useRecordingStore.getState().reset();
    useRecordingStore.getState().startRecording('Ride', 'gps');
    const startTime = useRecordingStore.getState().startTime as number;
    const guidance = record(FfiFollowStatus.OffRoute, 140);
    mockAdvance.mockReturnValue(guidance);
    const follower = { id: 'route' };
    const release = followRouteOnFixes(follower as never);

    await handleBackgroundLocations([
      {
        coords: {
          latitude: 47.5,
          longitude: 8.5,
          altitude: 400,
          accuracy: 5,
          speed: 5,
          heading: 0,
        },
        timestamp: startTime + 1000,
      } as never,
    ]);

    expect(mockAdvance).toHaveBeenCalledWith(follower, 47.5, 8.5);
    expect(useRecordingLiveStore.getState().guidance).toEqual(guidance);
    release();
  });
});
