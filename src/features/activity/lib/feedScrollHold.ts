/**
 * Holds the preview pool while the feed moves.
 *
 * A preview render is a WebView drawing a map, a base64 crossing and a file
 * write, and a fast scroll mounts a card a frame, each asking for one. Started
 * under the scroll they take the cores it needs, so they wait for it to settle.
 *
 * A drag holds, a fling keeps holding until its momentum ends, and a drag let
 * go with no fling releases once the settle has passed with nothing following.
 * The momentum begin arrives just after the drag end, so the release waits for
 * it rather than going on the drag end itself.
 */

/** How long after a drag ends a fling may still begin. */
export const SCROLL_SETTLE_MS = 150;

export interface ScrollHold {
  onScrollBeginDrag: () => void;
  onScrollEndDrag: () => void;
  onMomentumScrollBegin: () => void;
  onMomentumScrollEnd: () => void;
  /**
   * Points the hold at the pool, from an effect, since the pool is reached
   * through a ref. The returned disconnect releases a hold still taken, for
   * when the feed goes away mid-scroll.
   */
  connect: (hold: (held: boolean) => void) => () => void;
}

export function createScrollHold(): ScrollHold {
  let target: ((held: boolean) => void) | null = null;
  let held = false;
  let settle: ReturnType<typeof setTimeout> | null = null;

  const cancelSettle = () => {
    if (settle === null) return;
    clearTimeout(settle);
    settle = null;
  };
  const take = () => {
    cancelSettle();
    held = true;
    target?.(true);
  };
  const release = () => {
    cancelSettle();
    if (!held) return;
    held = false;
    target?.(false);
  };

  return {
    onScrollBeginDrag: take,
    onScrollEndDrag: () => {
      cancelSettle();
      settle = setTimeout(release, SCROLL_SETTLE_MS);
    },
    onMomentumScrollBegin: take,
    onMomentumScrollEnd: release,
    connect: (hold) => {
      target = hold;
      return () => {
        release();
        target = null;
      };
    },
  };
}
