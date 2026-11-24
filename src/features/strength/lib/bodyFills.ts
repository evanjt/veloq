import { BODY_PARTS } from './bodyPaths.generated';

export type BodyGender = 'male' | 'female';
export type BodySide = 'front' | 'back';

/** A muscle the body shades: its slug and the step or colour it takes. */
interface BodyMuscle {
  slug?: string;
  intensity?: number;
  color?: string;
  styles?: { fill?: string };
  /** The half trained when only one side is, else both. */
  side?: 'left' | 'right';
}

/** One filled shape of a diagram, in the drawing's own coordinates. */
interface BodyFill {
  d: string;
  fill: string;
  /** The part the shape belongs to. */
  slug: string;
  /** The step the shape is shaded in, from 1, or undefined when it keeps the drawing's colour. */
  step?: number;
}

/**
 * Every shape of one diagram with the colour it is filled with, in the order
 * the drawing paints them. A trained part takes its own fill, then its own
 * colour, then the colour its intensity picks from `colors`; an untrained one,
 * or the half of a part trained only on the other side, keeps the drawing's
 * own colour.
 */
export function bodyFills(
  muscles: readonly BodyMuscle[],
  gender: BodyGender,
  side: BodySide,
  colors: readonly string[]
): BodyFill[] {
  const trained = new Map<string, BodyMuscle>();
  for (const muscle of muscles) if (muscle.slug) trained.set(muscle.slug, muscle);

  const fills: BodyFill[] = [];
  for (const part of BODY_PARTS[gender][side]) {
    const own = part.color ?? '';
    const slug = part.slug ?? '';
    const muscle = part.slug ? trained.get(part.slug) : undefined;
    const step = muscle?.intensity && muscle.intensity > 0 ? muscle.intensity : undefined;
    const fill =
      muscle?.styles?.fill ?? muscle?.color ?? (step ? colors[step - 1] : undefined) ?? own;
    const shape = (d: string, half: 'left' | 'right') => {
      const kept = muscle?.side !== undefined && muscle.side !== half;
      return kept ? { d, fill: own, slug } : { d, fill, slug, ...(step ? { step } : {}) };
    };
    for (const d of part.path?.common ?? [])
      fills.push({ d, fill, slug, ...(step ? { step } : {}) });
    for (const d of part.path?.left ?? []) fills.push(shape(d, 'left'));
    for (const d of part.path?.right ?? []) fills.push(shape(d, 'right'));
  }
  return fills;
}
