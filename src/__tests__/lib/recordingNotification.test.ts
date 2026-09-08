/**
 * Scenario: a rider records with the app in the background, where the only
 * surface left is the foreground-service notification Android keeps up.
 *
 * Expected behaviour: that notification carries the ride, not a fixed string,
 * and its pause, lap and stop buttons drive the same store the screen does.
 */

import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import {
  TRACE_POINT_CAP,
  decimateTrace,
  buildRecordingNotificationPayload,
  applyRecordingNotificationAction,
} from '@/features/recording/lib/recordingNotification';

jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  buildRecordingBackup: jest.fn(() => ({ startTime: 1 })),
  saveRecordingBackup: jest.fn(),
  clearRecordingBackup: jest.fn(),
}));

const NOW = 1_700_000_000_000;

function stateWith(overrides: Record<string, unknown> = {}) {
  return {
    ...useRecordingStore.getState(),
    status: 'recording',
    activityType: 'Ride',
    mode: 'gps',
    startTime: NOW - 600_000,
    pausedDuration: 60_000,
    streams: {
      time: [0, 300, 600],
      latlng: [
        [47.5, 8.5],
        [47.51, 8.51],
        [47.52, 8.52],
      ],
      altitude: [400, 410, 420],
      heartrate: [],
      power: [],
      cadence: [],
      speed: [0, 8, 9],
      distance: [0, 2000, 4000],
    },
    ...overrides,
  } as never;
}

const translate = (key: string) => key;

describe('decimateTrace', () => {
  it('flattens lat,lng pairs in order', () => {
    expect(
      decimateTrace([
        [1, 2],
        [3, 4],
      ])
    ).toEqual([1, 2, 3, 4]);
  });

  it('caps a long trace and keeps its first and last point', () => {
    const points: [number, number][] = Array.from({ length: 4000 }, (_, i) => [i, -i]);
    const flat = decimateTrace(points);
    expect(flat.length / 2).toBeLessThanOrEqual(TRACE_POINT_CAP);
    expect(flat.slice(0, 2)).toEqual([0, -0]);
    expect(flat.slice(-2)).toEqual([3999, -3999]);
  });

  it('gives an empty trace back unchanged', () => {
    expect(decimateTrace([])).toEqual([]);
  });
});

describe('buildRecordingNotificationPayload', () => {
  it('carries the ride, not a fixed string', () => {
    const payload = buildRecordingNotificationPayload(stateWith(), {
      translate,
      isMetric: true,
      now: NOW,
    });
    expect(payload).not.toBeNull();
    expect(payload!.status).toBe('recording');
    expect(payload!.body).toContain('4.0');
    expect(payload!.trace).toHaveLength(6);
  });

  it('offers pause, lap and stop while recording', () => {
    const payload = buildRecordingNotificationPayload(stateWith(), {
      translate,
      isMetric: true,
      now: NOW,
    });
    expect(payload!.actions.map((a) => a.id)).toEqual(['pause', 'lap', 'stop']);
  });

  it('offers resume rather than pause once paused, and stops the chronometer', () => {
    const payload = buildRecordingNotificationPayload(stateWith({ status: 'paused' }), {
      translate,
      isMetric: true,
      now: NOW,
    });
    expect(payload!.actions.map((a) => a.id)).toEqual(['resume', 'lap', 'stop']);
    expect(payload!.running).toBe(false);
  });

  /**
   * Android ticks the chronometer itself from a wall-clock base, so a paused
   * span has to come off the base or the notification counts time the ride did
   * not spend moving.
   */
  it('bases the chronometer on moving time, not on wall clock', () => {
    const payload = buildRecordingNotificationPayload(stateWith(), {
      translate,
      isMetric: true,
      now: NOW,
    });
    expect(payload!.chronometerBase).toBe(NOW - 540_000);
  });

  it('has nothing to draw when the recording is idle', () => {
    expect(
      buildRecordingNotificationPayload(stateWith({ status: 'idle' }), {
        translate,
        isMetric: true,
        now: NOW,
      })
    ).toBeNull();
  });

  it('survives a session with no fix yet', () => {
    const payload = buildRecordingNotificationPayload(
      stateWith({
        streams: {
          time: [],
          latlng: [],
          altitude: [],
          heartrate: [],
          power: [],
          cadence: [],
          speed: [],
          distance: [],
        },
      }),
      { translate, isMetric: true, now: NOW }
    );
    expect(payload).not.toBeNull();
    expect(payload!.trace).toEqual([]);
  });
});

describe('applyRecordingNotificationAction', () => {
  beforeEach(() => {
    useRecordingStore.getState().reset();
    useRecordingStore.getState().startRecording('Ride', 'gps');
  });

  it('pauses and resumes the same store the screen drives', () => {
    applyRecordingNotificationAction('pause');
    expect(useRecordingStore.getState().status).toBe('paused');
    applyRecordingNotificationAction('resume');
    expect(useRecordingStore.getState().status).toBe('recording');
  });

  it('adds a lap', () => {
    const before = useRecordingStore.getState().laps.length;
    applyRecordingNotificationAction('lap');
    expect(useRecordingStore.getState().laps.length).toBe(before + 1);
  });

  it('stops the recording', () => {
    applyRecordingNotificationAction('stop');
    expect(useRecordingStore.getState().status).toBe('stopped');
  });

  it('ignores an action that arrives after the recording ended', () => {
    applyRecordingNotificationAction('stop');
    applyRecordingNotificationAction('lap');
    expect(useRecordingStore.getState().status).toBe('stopped');
    expect(useRecordingStore.getState().laps).toHaveLength(0);
  });
});
