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
