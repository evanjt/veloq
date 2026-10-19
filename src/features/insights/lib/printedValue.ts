import type { DataPoint } from '../types';

/** A value as a card prints it, its unit after it. */
export function printedValue(point: DataPoint): string {
  return point.unit ? `${String(point.value)} ${point.unit}` : String(point.value);
}
