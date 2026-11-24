// The body, front and back, drawn from the same shapes as the phone's diagram, with each muscle
// shaded in the step the engine put it in (the stylesheet colours each step) and a legend of the sets each step covers. A click on a
// muscle chooses it.

import { useTranslation } from 'react-i18next';

import {
  bodyFills,
  type BodyGender,
  type BodySide,
} from '../../src/features/strength/lib/bodyFills';
import { BODY_DRAWINGS } from '../../src/features/strength/lib/bodyPaths.generated';

/** The muscles the engine reports, which are the ones a click can choose. */
type Volume = { slug: string; shade: number };

type Shared = {
  volumes: readonly Volume[];
  /** The most weighted sets each shade covers, lightest first, as the engine reports them. */
  shadeCeilings: readonly number[];
  /** `M` or `F` as intervals.icu sends it; the body is female only for `F`. */
  sex: string | null | undefined;
  names: (slug: string) => string;
  chosen: string | null;
  onChoose: (slug: string) => void;
};

/** The legend's entries: untrained first, then each step with the most sets it covers. */
export function shadeLegend(shadeCeilings: readonly number[]): { shade: number; label: string }[] {
  return [
    { shade: 0, label: '0' },
    ...shadeCeilings.map((ceiling, at) => ({ shade: at + 1, label: String(ceiling) })),
  ];
}

function View(props: Shared & { side: BodySide; gender: BodyGender; label: string }) {
  const { gender, side } = props;
  const drawing = BODY_DRAWINGS[gender][side];
  const trained = new Set(props.volumes.map((volume) => volume.slug));
  const muscles = props.volumes.map((volume) => ({ slug: volume.slug, intensity: volume.shade }));
  return (
    <svg
      className="body-figure-view"
      viewBox={drawing.viewBox}
      role="group"
      aria-label={props.label}
      data-side={side}
    >
      <path className="body-figure-outline" d={drawing.outline} />
      {bodyFills(muscles, gender, side, []).map((shape, at) => {
        const chooses = trained.has(shape.slug);
        const common = {
          className: 'body-figure-shape',
          d: shape.d,
          'data-shade': shape.step,
        };
        return chooses ? (
          <path
            key={at}
            {...common}
            data-muscle={shape.slug}
            data-chosen={props.chosen === shape.slug || undefined}
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
        ) : (
          <path key={at} {...common} data-muscle={shape.slug} />
        );
      })}
    </svg>
  );
}

export function BodyFigure(props: Shared) {
  const { t } = useTranslation();
  const gender: BodyGender = props.sex === 'F' ? 'female' : 'male';
  return (
    <div className="body-figure">
      <div className="body-figure-views">
        <View label={t('connectPage.strength.bodyFront')} side="front" gender={gender} {...props} />
        <View label={t('connectPage.strength.bodyBack')} side="back" gender={gender} {...props} />
      </div>
      <div className="body-figure-legend" role="group" aria-label={t('strength.relativeVolume')}>
        {shadeLegend(props.shadeCeilings).map((step) => (
          <span key={step.shade} className="body-figure-step" data-shade={step.shade || undefined}>
            <span className="body-figure-swatch" data-shade={step.shade || undefined} />
            {step.label}
          </span>
        ))}
      </div>
    </div>
  );
}
