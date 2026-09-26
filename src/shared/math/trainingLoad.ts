/**
 * Training Stress Balance from chronic and acute training load. The single
 * source of the TSB = CTL - ATL formula. Returns null when either input is
 * missing or non-finite, so a caller never silently shows tsb = -atl when CTL
 * is absent.
 */
export function tsbFromLoads(ctl?: number | null, atl?: number | null): number | null {
  if (!Number.isFinite(ctl as number) || !Number.isFinite(atl as number)) return null;
  return (ctl as number) - (atl as number);
}

/**
 * Form as the app displays it: each load rounded before the subtraction.
 *
 * Every surface that shows Form rounds fitness and fatigue first, so the
 * number matches what intervals.icu prints, and each one was doing that by
 * hand. `tsbFromLoads` subtracts unrounded and is the formula, not the
 * display, so the two can differ by a unit.
 *
 * A missing or non-finite load reads as zero, because a chart draws a point
 * either way and a day with no CTL is a day with no fitness, not a day with
 * `-atl`.
 */
export function formFromLoads(ctl?: number | null, atl?: number | null): number {
  const round = (v?: number | null) => (Number.isFinite(v as number) ? Math.round(v as number) : 0);
  return round(ctl) - round(atl);
}
