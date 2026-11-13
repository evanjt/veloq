// The compared tracks drawn over a map slot: one SVG path per track in its
// compare colour, fitted together into the slot's box. It sits on top of the
// slot's own drawing and takes no pointer events.

import { compareOverlay, type Track } from './compare';

/** The overlay's box in SVG units; the slot keeps its aspect ratio around it. */
export const OVERLAY_BOX = { width: 1000, height: 1000, margin: 40 };

export function CompareOverlay({ tracks }: { tracks: readonly Track[] }) {
  const paths = compareOverlay(tracks, OVERLAY_BOX);
  if (paths.length === 0) return null;
  return (
    <svg
      id="compare-overlay"
      viewBox={`0 0 ${OVERLAY_BOX.width} ${OVERLAY_BOX.height}`}
      aria-hidden="true"
      focusable="false"
    >
      {paths.map((path) => (
        <path
          key={path.id}
          className={`compare-track ${path.colour}`}
          data-compared={path.id}
          d={path.d}
          fill="none"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </svg>
  );
}
