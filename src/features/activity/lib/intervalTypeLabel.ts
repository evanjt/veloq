/**
 * What the interval table's type column says.
 *
 * An athlete who plans a workout names its intervals, and those words separate
 * a warm up from the effort after it when both sit at the same zone. The zone
 * token is what there is to say when nobody has named it. Colour is the zone's
 * either way: a label never carries one.
 */

export interface IntervalTypeLabelInput {
  type: string;
  zone?: number | null;
  label?: string | null;
  /** Whether the row draws a zone colour, which is what makes `Z<n>` readable. */
  zoneColoured: boolean;
}

export function intervalTypeLabel({
  type,
  zone,
  label,
  zoneColoured,
}: IntervalTypeLabelInput): string {
  const named = label?.trim();
  if (named) return named;

  const isWork = type === 'WORK';
  if (isWork && zoneColoured) return `Z${zone}`;
  if (isWork) return 'Work';
  if (type === 'RECOVERY' || type === 'REST') return 'Rec';
  return type;
}
