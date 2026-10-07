import type { CutoverSummary } from '@/features/routes';
import { CUTOVER_FAILURE_KEYS } from './cutoverPhaseKeys';

/**
 * Whether the sections tab has something to show for the re-analysis: the run
 * has settled without failing and the stored diff moved at least one section.
 * Before that the tab holds no history, no changes and no retired sections.
 */
export function cutoverHasChangesToShow(
  summary: Pick<CutoverSummary, 'phase' | 'isRunning' | 'counts'>
): boolean {
  if (summary.isRunning || summary.counts === null) return false;
  if (summary.phase in CUTOVER_FAILURE_KEYS) return false;
  const { changed, new: added, gone } = summary.counts;
  return changed + added + gone > 0;
}
