/**
 * Whether the Strength tab is shown, and what it shows.
 *
 * Cached sets were the only thing that used to decide this, which meant an
 * athlete who trains with weights and has not been online since install saw no
 * strength feature at all, and so had no surface from which to retry the FIT
 * fetch that would fill it. Activities the engine knows are strength and has
 * no FIT outcome for are enough for the tab: it then says what it is waiting
 * for rather than that no strength workout exists.
 */
export type StrengthTabState = 'hidden' | 'awaiting' | 'ready';

export function strengthTabState(counts: {
  hasSets: boolean;
  unfetchedCount: number;
}): StrengthTabState {
  if (counts.hasSets) return 'ready';
  return counts.unfetchedCount > 0 ? 'awaiting' : 'hidden';
}
