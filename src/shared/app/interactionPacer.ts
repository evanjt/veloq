/**
 * Tells the engine when the athlete is touching the screen.
 *
 * The engine's background passes leave a gap between units of work while this
 * holds, so the cores are free for the thread drawing the screen. The value is
 * advisory in Rust and expires after `STALE_AFTER` in `net/pacing.rs`, which is
 * why a gesture that lasts is restated here: the restate interval must stay
 * well under that window.
 */

/** A second without a touch is the end of a gesture. */
export const IDLE_AFTER_MS = 1000;

/** Under half of Rust's five second expiry, so a live gesture never ages out. */
export const RESTATE_EVERY_MS = 2000;

export interface InteractionPacer {
  /** Call on every touch. Cheap: it only reaches the engine on an edge or a restate. */
  touch(): void;
  /** Say idle now and drop the timer, for unmount. */
  stop(): void;
}

export function createInteractionPacer(push: (interacting: boolean) => void): InteractionPacer {
  let interacting = false;
  let lastTouchAt = 0;
  let lastStatedAt = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const arm = (after: number) => {
    timer = setTimeout(() => {
      timer = null;
      // Touches only move `lastTouchAt`, so the timer is armed once per
      // gesture and re-armed here for whatever is left of the window.
      const remaining = IDLE_AFTER_MS - (Date.now() - lastTouchAt);
      if (remaining > 0) {
        arm(remaining);
        return;
      }
      interacting = false;
      push(false);
    }, after);
  };

  return {
    touch() {
      const now = Date.now();
      lastTouchAt = now;
      if (!interacting || now - lastStatedAt >= RESTATE_EVERY_MS) {
        interacting = true;
        lastStatedAt = now;
        push(true);
      }
      if (timer === null) arm(IDLE_AFTER_MS);
    },
    stop() {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      if (interacting) {
        interacting = false;
        push(false);
      }
    },
  };
}
