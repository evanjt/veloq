/**
 * Scenario: the payload size is counted in the app rather than taken from
 * `Buffer`. The suite beside this one covers the runtime that has no `Buffer`
 * and the multi-byte labels. What is left is the counter's agreement with a
 * real encoder, including the input a hand-rolled counter gets wrong: a high
 * surrogate that begins no pair.
 *
 * Expected behaviour: the count equals `Buffer.byteLength`. These are contract
 * tests, not regression tests, and they pass against a counter that assumes the
 * pair as well: `JSON.stringify` escapes a lone surrogate to six ASCII bytes
 * before the counter sees it, so nothing reaches the branch through this entry
 * point. They pin the contract for the next caller that does not go through
 * `JSON.stringify`, since an undercount is what lets a payload past the cap.
 */

import {
  buildContentState,
  contentStateBytes,
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

const state = (over: Partial<LiveActivityContentState> = {}): LiveActivityContentState => ({
  status: 'recording',
  timerFrom: 1_700_000_000_000,
  frozenElapsedS: null,
  distanceLabel: '12.4 km',
  speedLabel: '28.1 km/h',
  trace: null,
  ...over,
});

const encoded = (s: LiveActivityContentState) => Buffer.byteLength(JSON.stringify(s), 'utf8');

it('agrees with a real encoder on a card carrying a trace', () => {
  const built = buildContentState({
    now: 1_700_000_600_000,
    startTime: 1_700_000_000_000,
    pausedDurationMs: 0,
    distanceLabel: '12.4 km',
    speedLabel: '28.1 km/h',
    gps: track(20),
    status: 'recording',
  });

  expect(built.trace).not.toBeNull();
  expect(contentStateBytes(built)).toBe(encoded(built));
});

it('agrees on a surrogate pair, which is one code point of four bytes', () => {
  const paired = state({ distanceLabel: '12.4 km \u{1f6b4}' });

  expect(contentStateBytes(paired)).toBe(encoded(paired));
});

it('agrees on a high surrogate that begins no pair', () => {
  const lone = state({ distanceLabel: '\ud800€' });

  expect(contentStateBytes(lone)).toBe(encoded(lone));
});

it('agrees on a trailing high surrogate at the end of a label', () => {
  const trailing = state({ distanceLabel: '12.4 km \ud800' });

  expect(contentStateBytes(trailing)).toBe(encoded(trailing));
});
