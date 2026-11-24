import { FfiDayLoadStatus, type DayLoad } from 'veloqrs';

/** What the strip prints for a selected day's recorded activity load. */
interface DayLoadReadout {
  status: 'complete' | 'partial' | 'unavailable';
  /** Rounded known total, absent when no activity that day carries a load. */
  total: number | null;
}

/**
 * The readout for one day's engine answer. A rest day, or a day the engine has
 * not answered for, has nothing to print: the strip's own label names rest.
 */
export function dayLoadReadout(day: DayLoad | undefined): DayLoadReadout | null {
  if (!day) return null;
  switch (day.status) {
    case FfiDayLoadStatus.Complete:
      return { status: 'complete', total: Math.round(day.total ?? 0) };
    case FfiDayLoadStatus.Partial:
      return { status: 'partial', total: Math.round(day.total ?? 0) };
    case FfiDayLoadStatus.Unavailable:
      return { status: 'unavailable', total: null };
    default:
      return null;
  }
}
