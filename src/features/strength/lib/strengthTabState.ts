/**
 * Whether the Strength tab is shown, and what it shows.
 *
 * Cached sets were the only thing that used to decide this, which meant an
 * athlete who trains with weights and has not been online since install saw no
 * strength feature at all, and so had no surface from which to retry the FIT
 * fetch that would fill it. Activities the engine knows are strength and has
 * no FIT outcome for are enough for the tab: it then says what it is waiting
 * for rather than that no strength workout exists.
 *
 * While a sync runs the files are owed rather than left behind, so the tab
 * reports a download in progress and keeps 'awaiting' for a settled sync.
 */
export type StrengthTabState = 'hidden' | 'awaiting' | 'downloading' | 'ready';

export function strengthTabState(counts: {
  hasSets: boolean;
  unfetchedCount: number;
  isSyncing: boolean;
}): StrengthTabState {
  if (counts.hasSets) return 'ready';
  if (counts.unfetchedCount === 0) return 'hidden';
  return counts.isSyncing ? 'downloading' : 'awaiting';
}
