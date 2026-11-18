// How the map frames a box: the padding that keeps it clear of what is drawn over the map, and
// the rule that a frame is applied once per request. Pure, so a test drives it without a renderer.

/** A rectangle in screen pixels. */
export type Rect = { left: number; top: number; right: number; bottom: number };

export type Insets = { top: number; right: number; bottom: number; left: number };

/** The padding left on every edge before any overlay is counted. */
export const FIT_PADDING_PX = 48;

/** A fit never zooms past this, so a short track is not framed as a single street. */
export const MAX_FRAME_ZOOM = 16;

/** The ease of a frame, in milliseconds. */
export const FRAME_MS = 400;

/** The share of each axis the fitted box keeps, however much is open over the map. */
const MIN_CLEAR_SHARE = 1 / 3;

/** A camera that frames a box, as far as framing reads it. */
export type FrameRequest = {
  bounds?: readonly number[];
  /** A number that changes for every request, so asking for the same box again frames it again. */
  seq?: number;
};

export const frameDuration = (reducedMotion: boolean) => (reducedMotion ? 0 : FRAME_MS);

/**
 * The padding on each edge: the base, or the depth an overlay reaches into the map from the edge
 * it sits against, whichever is greater. A wide overlay sits against the nearer of the top and
 * bottom, a tall one against the nearer of the left and right. An overlay that is closed (no
 * area) or outside the map counts for nothing.
 */
export function framePadding(map: Rect, overlays: readonly Rect[]): Insets {
  const width = map.right - map.left;
  const height = map.bottom - map.top;
  const reach: Insets = { top: 0, right: 0, bottom: 0, left: 0 };
  for (const overlay of overlays) {
    const left = Math.max(overlay.left, map.left);
    const right = Math.min(overlay.right, map.right);
    const top = Math.max(overlay.top, map.top);
    const bottom = Math.min(overlay.bottom, map.bottom);
    if (right <= left || bottom <= top) continue;
    if (right - left > bottom - top) {
      if (top - map.top <= map.bottom - bottom) reach.top = Math.max(reach.top, bottom - map.top);
      else reach.bottom = Math.max(reach.bottom, map.bottom - top);
    } else if (left - map.left <= map.right - right) {
      reach.left = Math.max(reach.left, right - map.left);
    } else {
      reach.right = Math.max(reach.right, map.right - left);
    }
  }
  const padded: Insets = {
    top: reach.top + FIT_PADDING_PX,
    right: reach.right + FIT_PADDING_PX,
    bottom: reach.bottom + FIT_PADDING_PX,
    left: reach.left + FIT_PADDING_PX,
  };
  return {
    ...shrink(padded.left, padded.right, width, 'left', 'right'),
    ...shrink(padded.top, padded.bottom, height, 'top', 'bottom'),
  } as Insets;
}

/** Scale an opposing pair down until the span between them is the share the box keeps. */
function shrink<A extends string, B extends string>(
  a: number,
  b: number,
  span: number,
  nameA: A,
  nameB: B
): Record<A | B, number> {
  const room = span * (1 - MIN_CLEAR_SHARE);
  const scale = a + b > room ? room / (a + b) : 1;
  return { [nameA]: a * scale, [nameB]: b * scale } as Record<A | B, number>;
}

/** Names a request: its sequence number, or the bounds themselves for a caller that sends none. */
export function frameToken(request: FrameRequest): string | null {
  if (!request.bounds) return null;
  return request.seq !== undefined ? `seq:${request.seq}` : `box:${request.bounds.join(',')}`;
}

/** A request is framed when it is not the one last applied. Panning and data refreshes change neither. */
export const shouldFrame = (applied: string | null, token: string | null): boolean =>
  token !== null && token !== applied;

/** A container's size in CSS pixels. */
export type Size = { width: number; height: number };

/** How long a container's size holds still before the map is framed again for it. */
export const RESIZE_SETTLE_MS = 150;

/**
 * A map is framed again for a container that has an area and is not the size last framed, so a
 * pane opening or a window resize leaves the whole box in view. A change under a pixel is
 * rounding, and a hidden container has no area to frame into.
 */
export function shouldRefit(framed: Size | null, now: Size): boolean {
  if (now.width <= 0 || now.height <= 0) return false;
  if (framed === null) return true;
  return Math.abs(now.width - framed.width) >= 1 || Math.abs(now.height - framed.height) >= 1;
}
