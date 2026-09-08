import {
  CONTENT_STATE_MAX_BYTES,
  buildContentState,
  contentStateBytes,
  fitContentState,
} from '@/features/recording/lib/liveActivity/contentState';
import type { RecordingGpsPoint } from '@/features/recording/types';

function track(count: number): RecordingGpsPoint[] {
  return Array.from({ length: count }, (_, i) => ({
    latitude: -33.86 + i * 0.0004,
    longitude: 151.2 + Math.sin(i / 7) * 0.004,
    altitude: null,
    accuracy: 5,
    speed: 8,
    heading: null,
    timestamp: 1_700_000_000_000 + i * 1000,
  }));
}

const base = {
  now: 1_700_000_600_000,
  startTime: 1_700_000_000_000,
  pausedDurationMs: 0,
  distanceLabel: '12.4 km',
  speedLabel: '28.1 km/h',
  gps: track(20),
};

describe('buildContentState', () => {
  it('counts the timer from a start net of paused time', () => {
    const state = buildContentState({ ...base, status: 'recording', pausedDurationMs: 90_000 });

    expect(state.status).toBe('recording');
    expect(state.frozenElapsedS).toBeNull();
    // 600 s wall clock less 90 s paused is 510 s of moving time.
    expect(base.now - state.timerFrom).toBe(510_000);
  });

  it('freezes the elapsed seconds while paused, because a running timer would lie', () => {
    const state = buildContentState({ ...base, status: 'paused', pausedDurationMs: 60_000 });

    expect(state.status).toBe('paused');
    expect(state.frozenElapsedS).toBe(540);
  });

  it('normalises the trace into the unit box and keeps both ends', () => {
    const state = buildContentState({ ...base, status: 'recording' });

    expect(state.trace).not.toBeNull();
    for (const [x, y] of state.trace!.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    expect(state.trace!.points.length).toBeGreaterThanOrEqual(2);
  });

  it('carries no trace when there are too few fixes to draw one', () => {
    expect(buildContentState({ ...base, status: 'recording', gps: [] }).trace).toBeNull();
    expect(buildContentState({ ...base, status: 'recording', gps: track(1) }).trace).toBeNull();
  });

  it('never exceeds the ActivityKit payload cap, whatever the track length', () => {
    const state = buildContentState({ ...base, status: 'recording', gps: track(50_000) });

    expect(contentStateBytes(state)).toBeLessThanOrEqual(CONTENT_STATE_MAX_BYTES);
    expect(state.trace!.points.length).toBeGreaterThanOrEqual(2);
  });
});

describe('fitContentState', () => {
  const oversize = buildContentState({ ...base, status: 'recording', gps: track(400) });

  it('decimates the trace but keeps the first and last point', () => {
    const full = { ...oversize, trace: { points: oversize.trace!.points, aspect: 1 } };
    const fitted = fitContentState(full, 600);

    expect(contentStateBytes(fitted)).toBeLessThanOrEqual(600);
    expect(fitted.trace!.points.length).toBeLessThan(full.trace!.points.length);
    expect(fitted.trace!.points[0]).toEqual(full.trace!.points[0]);
    expect(fitted.trace!.points.at(-1)).toEqual(full.trace!.points.at(-1));
  });

  it('drops the trace rather than the metrics when even two points will not fit', () => {
    const fitted = fitContentState(oversize, 120);

    expect(fitted.trace).toBeNull();
    expect(fitted.distanceLabel).toBe('12.4 km');
    expect(fitted.speedLabel).toBe('28.1 km/h');
  });

  it('leaves a payload that already fits untouched', () => {
    const small = buildContentState({ ...base, status: 'recording', gps: track(4) });

    expect(fitContentState(small, CONTENT_STATE_MAX_BYTES)).toEqual(small);
  });
});
