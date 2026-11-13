// A sport's outline glyph for a table cell, drawn as inline SVG in the current
// text colour. The family comes from `sportMark`; the sport's own name is the
// accessible label.

import type { SportMark } from './preview';

const SHAPES: Record<SportMark['family'], string[]> = {
  ride: [
    'M6 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M18 18a3 3 0 1 0 0-6 3 3 0 0 0 0 6z',
    'M6 15l4-7h5l3 7',
    'M10 8l3 7',
  ],
  run: ['M14 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z', 'M8 21l3-6-3-3 3-5 4 3 3 1', 'M11 15l4 2v4'],
  swim: [
    'M3 17c2 0 2-1.5 4.5-1.5S10 17 12 17s2.5-1.5 4.5-1.5S19 17 21 17',
    'M3 21c2 0 2-1.5 4.5-1.5S10 21 12 21',
  ],
  walk: [
    'M13 5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3z',
    'M10 21l2-7-2-3 2-5 3 3h3',
    'M12 14l3 2 1 5',
  ],
  other: ['M12 16a4 4 0 1 0 0-8 4 4 0 0 0 0 8z'],
};

export function SportGlyph({ family, label }: { family: SportMark['family']; label: string }) {
  return (
    <svg
      className="sport-glyph"
      data-sport={family}
      viewBox="0 0 24 24"
      width="20"
      height="20"
      role="img"
      aria-label={label}
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      {SHAPES[family].map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}
