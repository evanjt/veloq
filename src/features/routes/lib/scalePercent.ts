/**
 * Scale a Rust-reported 0–100 percent into an arbitrary sub-range of the
 * overall sync progress bar.
 */
export function scalePercent(rustPercent: number, rangeStart: number, rangeEnd: number): number {
  return Math.min(
    Math.round(rangeEnd),
    Math.round(rangeStart + (rustPercent / 100) * (rangeEnd - rangeStart))
  );
}
