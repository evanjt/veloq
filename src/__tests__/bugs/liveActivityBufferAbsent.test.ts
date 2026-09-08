/**
 * Scenario: the Live Activity payload was sized with `Buffer.byteLength`, a
 * Node API. Hermes has no `Buffer` and the app ships no polyfill, so the first
 * card update of every ride threw a ReferenceError on device. Jest runs under
 * Node, where `Buffer` is a global, so the suite could not see it.
 *
 * Expected behaviour: the size is measured without `Buffer`, and it is a UTF-8
 * byte count, not a UTF-16 code-unit count, because that is what ActivityKit's
 * 4 KB limit is denominated in.
 */

import {
  CONTENT_STATE_MAX_BYTES,
  buildContentState,
  contentStateBytes,
  fitContentState,
  type LiveActivityContentState,
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

/** The runtime the app actually ships on: no `Buffer` anywhere. */
function withoutBuffer<T>(body: () => T): T {
  const held = (globalThis as { Buffer?: unknown }).Buffer;
  delete (globalThis as { Buffer?: unknown }).Buffer;
  try {
    return body();
  } finally {
    (globalThis as { Buffer?: unknown }).Buffer = held;
  }
}

const state = (over: Partial<LiveActivityContentState> = {}): LiveActivityContentState => ({
  status: 'recording',
  timerFrom: 1_700_000_000_000,
  frozenElapsedS: null,
  distanceLabel: '12.4 km',
  speedLabel: '28.1 km/h',
  trace: null,
  ...over,
});

it('sizes a payload on a runtime with no Buffer', () => {
  expect(withoutBuffer(() => contentStateBytes(state()))).toBeGreaterThan(0);
});

it('builds a card carrying a trace on a runtime with no Buffer', () => {
  // A single fix yields no outline, so nothing is ever measured and the bug
  // hides. The throw arrives with the first update that carries a trace.
  const built = withoutBuffer(() => buildContentState({ ...base, status: 'recording' }));

  expect(built.trace).not.toBeNull();
});

it('still shrinks an oversized trace on a runtime with no Buffer', () => {
  const built = withoutBuffer(() =>
    buildContentState({ ...base, status: 'recording', gps: track(50_000) })
  );

  expect(withoutBuffer(() => contentStateBytes(built))).toBeLessThanOrEqual(
    CONTENT_STATE_MAX_BYTES
  );
});

it('counts UTF-8 bytes, not UTF-16 code units, which is what the 4 KB limit means', () => {
  // "3,2 km" in a locale that uses a non-breaking space, plus an emoji: 2 bytes
  // and 4 bytes respectively where a code-unit count would say 1 and 2.
  const ascii = contentStateBytes(state({ distanceLabel: 'aaaaaa' }));
  const wide = contentStateBytes(state({ distanceLabel: 'aaaa \u{1f6b4}' }));

  expect(wide - ascii).toBe(4);
});

it('agrees with Buffer, which is the measurement it replaces', () => {
  const built = buildContentState({ ...base, status: 'recording' });
  const json = JSON.stringify(built);

  expect(contentStateBytes(built)).toBe(Buffer.byteLength(json, 'utf8'));
});

it('measures a lone surrogate the way an encoder does, rather than throwing', () => {
  const lone = state({ distanceLabel: '\ud800' });

  expect(withoutBuffer(() => contentStateBytes(lone))).toBe(
    Buffer.byteLength(JSON.stringify(lone), 'utf8')
  );
});

it('leaves fitContentState able to drop the trace entirely', () => {
  const fitted = withoutBuffer(() =>
    fitContentState(state({ trace: { points: [[0, 0]], aspect: 1 } }), 10)
  );

  expect(fitted.trace).toBeNull();
});
