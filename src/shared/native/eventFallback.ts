/**
 * A timer for the case where the engine cannot announce anything.
 *
 * `initWithPath` withholds the observer when the binding's checksum initialise
 * or `setObserver` throws, and a release build strips the `console.warn` that
 * is the only other trace. Every screen that waits on an engine event then
 * waits for ever: the sync line holds its first step and the feed stays on its
 * standby until a manual refresh. That was five days of B1185.
 *
 * So the readers that key on an announcement subscribe here as well. While the
 * engine says its events are dead, this ticks once a second and they re-read;
 * while they are live, there is no timer and this costs nothing. The rate is
 * the fallback `followDetectionRun` already polls at, which is the other path
 * that reads `eventsAreLive` rather than trusting the event.
 *
 * Liveness is decided when the fallback starts rather than per tick, because
 * the engine is opened after the first screens mount and is re-opened by a
 * restore, so one read does not settle it for the life of the process.
 * `reconsiderFallback` is how a caller that knows the engine changed says so.
 */
import { getEngine } from './engine';

/** One second, the rate `followDetectionRun` falls back to. */
export const FALLBACK_TICK_MS = 1000;

/**
 * Whether an engine event is worth waiting for.
 *
 * A handle that cannot say is taken as able to announce, which is what every
 * handle did before `eventsAreLive` existed. A handle that throws is not: a
 * host that cannot answer a local read is not one to stake a screen on.
 */
export function eventsAreLive(): boolean {
  const engine = getEngine();
  if (!engine?.eventsAreLive) return true;
  try {
    return engine.eventsAreLive();
  } catch {
    return false;
  }
}

const listeners = new Set<() => void>();
let timer: ReturnType<typeof setInterval> | null = null;

function stop() {
  if (!timer) return;
  clearInterval(timer);
  timer = null;
}

function start() {
  if (timer || listeners.size === 0 || eventsAreLive()) return;
  timer = setInterval(() => {
    // The observer is registered once per engine, so this can only turn true
    // by the engine being replaced. Reading it per tick is what lets the timer
    // end itself when that happens.
    if (eventsAreLive()) {
      stop();
      return;
    }
    listeners.forEach((listener) => listener());
  }, FALLBACK_TICK_MS);
}

/** Re-decide whether the fallback is needed, after the engine changed. */
export function reconsiderFallback(): void {
  stop();
  start();
}

/**
 * Tick `listener` once a second while the engine cannot announce. The returned
 * function unsubscribes, and the timer goes with the last subscriber.
 */
export function subscribeToFallbackTick(listener: () => void): () => void {
  listeners.add(listener);
  start();
  return () => {
    listeners.delete(listener);
    if (listeners.size === 0) stop();
  };
}
