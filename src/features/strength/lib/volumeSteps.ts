/** The steps the engine shades a trained muscle in, one per colour of the sequential ramp. */
export const VOLUME_STEPS = 5;

/**
 * The most weighted sets each body-diagram step covers, lightest first, to a
 * tenth of a set. The engine puts a muscle in the step its share of the most
 * trained muscle's sets rounds up to, so step k ends at k fifths of that maximum
 * and the last step at the maximum itself.
 */
export function volumeStepCeilings(maxWeightedSets: number): number[] {
  const max = Number.isFinite(maxWeightedSets) && maxWeightedSets > 0 ? maxWeightedSets : 0;
  return Array.from(
    { length: VOLUME_STEPS },
    (_, i) => Math.round(((max * (i + 1)) / VOLUME_STEPS) * 10) / 10
  );
}
