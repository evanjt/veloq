import type { CutoverCounts } from 'veloqrs';

type Translate = (key: string, vars?: Record<string, unknown>) => string;

/** The stored diff in one line: the totals and the breakdown, or that nothing moved. */
export function describeCutoverCounts(counts: CutoverCounts, t: Translate): string {
  if (counts.changed + counts.new + counts.gone === 0) {
    return t('whatsNew.v040.diffUnchanged', { count: counts.unchanged });
  }
  // The detector kept none of the library. The totals alone read as a deletion, so say that it kept none.
  if (counts.proposed === 0 && counts.current > 0) {
    return t('whatsNew.v040.diffNoneKept', { count: counts.gone });
  }
  return t('common.sentencePair', {
    first: t('whatsNew.v040.diffTotals', { current: counts.current, proposed: counts.proposed }),
    second: t('whatsNew.v040.diffBreakdown', {
      new: counts.new,
      changed: counts.changed,
      gone: counts.gone,
    }),
  });
}
