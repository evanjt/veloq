/** The ride the Fitness card reports, and the value intervals.icu stored for it. */
export interface DecouplingSource {
  activityId: string;
  name: string;
  /** `start_date_local` as stored. */
  date: string;
  /** Percentage, as intervals.icu computed it. */
  decoupling: number;
}

/**
 * intervals.icu's stored decoupling, or null when the body carries no finite
 * number. The same field on an interval arrives as the string `-Infinity` when
 * a half has no power, so a value is never formatted before it is read here.
 */
export function storedDecoupling(activity: { decoupling?: unknown }): number | null {
  const value = activity.decoupling;
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
