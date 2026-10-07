/**
 * The unit a distance parameter is edited in. The engine stores metres, so the
 * editor converts what is shown and what is typed and the value that leaves it
 * is always metres.
 *
 * A short distance is edited in metres or feet and the long section ceiling in
 * kilometres or miles, the unit its caption would promote to.
 */

import { KM_TO_MI, M_TO_FT } from '@/shared/format/format';

export interface EditorUnit {
  label: 'm' | 'km' | 'ft' | 'mi';
  /** How many of this unit make one metre. */
  perMetre: number;
}

export function distanceEditorUnit(isMetric: boolean, long: boolean): EditorUnit {
  if (isMetric) {
    return long ? { label: 'km', perMetre: 1 / 1000 } : { label: 'm', perMetre: 1 };
  }
  return long ? { label: 'mi', perMetre: KM_TO_MI / 1000 } : { label: 'ft', perMetre: M_TO_FT };
}

const DECIMALS: Record<EditorUnit['label'], number> = { m: 0, ft: 0, km: 2, mi: 2 };

/** A stored value as the editor shows it, or as a range bound in its note. */
export function toEditorText(metres: number, unit: EditorUnit | null): string {
  if (!unit) return String(metres);
  const value = metres * unit.perMetre;
  return String(Number(value.toFixed(DECIMALS[unit.label])));
}

/** A typed value as the engine takes it: whole metres for a converted distance. */
export function fromEditorValue(value: number, unit: EditorUnit | null): number {
  if (!unit) return value;
  return Math.round(value / unit.perMetre);
}
