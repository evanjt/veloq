/**
 * What a collapsed chart row is allowed to state.
 *
 * The row summary and the chart body used to read different sources, and only
 * the body knows whether there is a series to draw, so a row could offer a
 * figure the chart then said did not exist. One rule for both: a row states a
 * value only when its chart can plot one.
 */

export interface CurveHeaderValueInput<T> {
  /** The figure the row would show. */
  value: T | null | undefined;
  /** Whether the chart under it has a series to draw. */
  hasSeries: boolean;
  isLoading?: boolean;
  isError?: boolean;
}

export function curveHeaderValue<T>({
  value,
  hasSeries,
  isLoading,
  isError,
}: CurveHeaderValueInput<T>): T | null {
  if (isLoading || isError || !hasSeries) return null;
  return value ?? null;
}
