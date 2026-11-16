// A schematic body, front and back, with each muscle shaded by how much of the period's work it
// took. The shading is the engine's weighted sets relative to the most-worked muscle; a muscle
// the figure does not draw is still in the table beside it. A click on a muscle chooses it.

import { useTranslation } from 'react-i18next';

type Shape = { slug: string; d: string };

const DELTOIDS =
  'M28 44 q-9 3 -10 14 q4 4 10 2 q4 -8 2 -16 Z M72 44 q9 3 10 14 q-4 4 -10 2 q-4 -8 -2 -16 Z';
const UPPER_ARM =
  'M18 62 q-3 14 0 24 q5 2 8 0 q2 -12 2 -24 q-5 2 -10 0 Z M82 62 q3 14 0 24 q-5 2 -8 0 q-2 -12 -2 -24 q5 2 10 0 Z';
const FOREARM =
  'M16 90 q-4 18 -4 30 q5 2 8 0 q3 -14 6 -30 Z M84 90 q4 18 4 30 q-5 2 -8 0 q-3 -14 -6 -30 Z';

/** Front view outlines, in a 100 by 220 box. */
const FRONT: Shape[] = [
  { slug: 'deltoids', d: DELTOIDS },
  { slug: 'chest', d: 'M32 46 h16 v18 q-10 3 -16 -3 Z M52 46 h16 l0 15 q-6 6 -16 3 Z' },
  { slug: 'biceps', d: UPPER_ARM },
  { slug: 'forearm', d: FOREARM },
  { slug: 'abs', d: 'M40 68 h20 v34 q-10 5 -20 0 Z' },
  { slug: 'obliques', d: 'M32 68 h7 v32 q-5 -4 -8 -10 Z M68 68 h-7 v32 q5 -4 8 -10 Z' },
  { slug: 'adductors', d: 'M44 118 h12 l-2 30 h-8 Z' },
  { slug: 'quadriceps', d: 'M30 112 h14 l-2 52 q-8 3 -14 0 Z M70 112 h-14 l2 52 q8 3 14 0 Z' },
];

/** Back view outlines, in the same box. */
const BACK: Shape[] = [
  { slug: 'trapezius', d: 'M38 34 h24 l6 12 h-14 v10 h-8 v-10 h-14 Z' },
  { slug: 'deltoids', d: DELTOIDS },
  { slug: 'upper-back', d: 'M32 56 h16 v22 h-14 Z M52 56 h16 l-2 22 h-14 Z' },
  { slug: 'triceps', d: UPPER_ARM },
  { slug: 'forearm', d: FOREARM },
  { slug: 'lower-back', d: 'M38 80 h24 v20 h-24 Z' },
  { slug: 'gluteal', d: 'M32 102 h18 v18 h-20 Z M50 102 h18 l2 16 h-20 Z' },
  { slug: 'hamstring', d: 'M30 122 h18 l-2 44 q-8 3 -14 0 Z M70 122 h-18 l2 44 q8 3 14 0 Z' },
  { slug: 'calves', d: 'M31 170 h13 l-2 40 h-9 Z M69 170 h-13 l2 40 h9 Z' },
];

const HEAD = 'M50 6 a11 13 0 1 0 0.1 0 Z';

type Shared = {
  intensity: ReadonlyMap<string, number>;
  names: (slug: string) => string;
  chosen: string | null;
  onChoose: (slug: string) => void;
};

function View(props: Shared & { label: string; shapes: Shape[] }) {
  return (
    <svg className="body-figure-view" viewBox="0 0 100 220" role="group" aria-label={props.label}>
      <path className="body-figure-head" d={HEAD} />
      {props.shapes.map((shape) => {
        const level = props.intensity.get(shape.slug);
        return (
          <path
            key={shape.slug}
            className="body-figure-muscle"
            d={shape.d}
            data-muscle={shape.slug}
            data-chosen={props.chosen === shape.slug || undefined}
            style={{ fillOpacity: level === undefined ? 0 : 0.12 + level * 0.88 }}
            role="button"
            tabIndex={0}
            aria-label={props.names(shape.slug)}
            aria-pressed={props.chosen === shape.slug}
            onClick={() => props.onChoose(shape.slug)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                props.onChoose(shape.slug);
              }
            }}
          >
            <title>{props.names(shape.slug)}</title>
          </path>
        );
      })}
    </svg>
  );
}

export function BodyFigure(props: Shared) {
  const { t } = useTranslation();
  return (
    <div className="body-figure">
      <View label={t('connectPage.strength.bodyFront')} shapes={FRONT} {...props} />
      <View label={t('connectPage.strength.bodyBack')} shapes={BACK} {...props} />
    </div>
  );
}
