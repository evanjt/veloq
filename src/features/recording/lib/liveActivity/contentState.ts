import { composeRouteOutline, type RouteTrack } from '@/shared/geo/routePreview';
import type { RecordingStatus } from '@/features/recording/types';
import { LIVE_ACTIVITY_STALE_MS } from '@/features/recording/lib/constants';

/**
 * ActivityKit rejects a ContentState whose encoded form exceeds 4 KB, and the
 * rejection is a thrown update rather than a truncated card. The budget here is
 * under that so the Swift encoding, which is not this JSON, has room to differ.
 */
export const CONTENT_STATE_MAX_BYTES = 3800;

/** Normalised 0..1 outline of the ride so far, y growing downward like screen pixels. */
export interface LiveActivityTrace {
  points: [number, number][];
  aspect: number;
}

export interface LiveActivityContentState {
  status: 'recording' | 'paused';
  /**
   * Wall-clock ms the card counts up from. It is the start less the paused time,
   * so `Text(timerInterval:)` runs on its own and the card keeps ticking while
   * the app is suspended. A pushed elapsed value would freeze there instead.
   */
  timerFrom: number;
  /**
   * Moving seconds when this state was built. The card shows it whenever its own
   * clock must not run: through a pause, and once the card has gone stale.
   */
  frozenElapsedS: number;
  distanceLabel: string;
  speedLabel: string;
  trace: LiveActivityTrace | null;
  /**
   * Wall-clock ms after which the card is stale. Each push moves it on, so it is
   * reached only once the process stops pushing, which is how a ride the system
   * killed stops counting on the lock screen instead of running for hours.
   */
  staleAt: number;
}

export interface ContentStateInput {
  status: RecordingStatus;
  now: number;
  /** Moving milliseconds at `now`, from the store's one clock (`movingMsAt`). */
  movingMs: number;
  distanceLabel: string;
  speedLabel: string;
  gps: RouteTrack;
}

/**
 * UTF-8 length of a string, counted here rather than taken from a runtime global.
 * `Buffer` is Node's and the app does not have it, and `TextEncoder` allocates the
 * whole encoded copy to be asked for its length. This runs on every fit pass.
 */
function utf8ByteLength(text: string): number {
  let bytes = 0;
  for (let i = 0; i < text.length; i += 1) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff && i + 1 < text.length) {
      // A surrogate pair is one code point of four bytes, not two of three. A
      // high surrogate followed by anything else is not a pair: it is three
      // bytes for the replacement character an encoder substitutes, and the
      // next unit still carries its own. Assuming the pair undercounts, which
      // is the direction that lets a payload past the cap.
      const low = text.charCodeAt(i + 1);
      if (low >= 0xdc00 && low <= 0xdfff) {
        bytes += 4;
        i += 1;
      } else bytes += 3;
    } else bytes += 3;
  }
  return bytes;
}

export function contentStateBytes(state: LiveActivityContentState): number {
  return utf8ByteLength(JSON.stringify(state));
}

/**
 * Halve a point list, keeping the first and the last. Decimating rather than
 * truncating keeps the shape of the whole ride, which is the only thing the
 * trace is there to show.
 */
function decimate(points: [number, number][]): [number, number][] {
  if (points.length <= 2) return points;
  const kept: [number, number][] = [];
  for (let i = 0; i < points.length - 1; i += 2) kept.push(points[i]);
  kept.push(points[points.length - 1]);
  return kept;
}

/** Shrink the trace until the payload fits, then drop it rather than the metrics. */
export function fitContentState(
  state: LiveActivityContentState,
  maxBytes: number = CONTENT_STATE_MAX_BYTES
): LiveActivityContentState {
  let fitted = state;
  while (fitted.trace && contentStateBytes(fitted) > maxBytes) {
    const points = fitted.trace.points;
    fitted =
      points.length <= 2
        ? { ...fitted, trace: null }
        : { ...fitted, trace: { ...fitted.trace, points: decimate(points) } };
  }
  return fitted;
}

export function buildContentState(input: ContentStateInput): LiveActivityContentState {
  const movingMs = Math.max(0, input.movingMs);
  const paused = input.status === 'paused';
  const preview = composeRouteOutline(input.gps);

  return fitContentState({
    status: paused ? 'paused' : 'recording',
    timerFrom: input.now - movingMs,
    frozenElapsedS: Math.round(movingMs / 1000),
    distanceLabel: input.distanceLabel,
    speedLabel: input.speedLabel,
    trace: preview ? { points: preview.points, aspect: preview.aspect } : null,
    staleAt: input.now + LIVE_ACTIVITY_STALE_MS,
  });
}
