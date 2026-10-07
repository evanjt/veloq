import { formatDuration } from '@/shared/format/format';
import type { Insight, SectionPR, TFunc } from '../types';
import { makeInsight } from '../lib/insightBuilder';
import { confidenceFrom, maxPerCategoryFor } from '../lib/config';
import { sectionWithSport } from '../lib/cardSport';
import { sparkline } from '../lib/sparkline';
import { sectionPairKey } from '../lib/sectionIdentity';

const DAY_MS = 86_400_000;

export function generateSectionPRInsights(
  recentPRs: SectionPR[],
  now: number,
  t: TFunc
): Insight[] {
  if (!recentPRs || recentPRs.length === 0) return [];

  const insights: Insight[] = [];
  // Emit up to the surface cap for this category - pipeline will dedupe/re-rank.
  const prs = recentPRs.slice(0, maxPerCategoryFor('section_pr'));

  for (const pr of prs) {
    if (!pr.sectionId || !pr.sectionName || !Number.isFinite(pr.bestTime)) continue;
    insights.push(
      makeInsight({
        id: `section_pr-${sectionPairKey(pr.sectionId, pr.sportType)}`,
        category: 'section_pr',
        priority: 1,
        icon: 'trophy-outline',
        iconTone: 'record',
        title: t('insights.sectionPr', { name: sectionWithSport(pr.sectionName, pr.sportType, t) }),
        subtitle: t('insights.sectionPrSubtitle', {
          time: formatDuration(pr.bestTime),
          daysAgo: pr.daysAgo,
        }),
        navigationTarget: `/section/${pr.sectionId}`,
        timestamp: now,
        confidence: confidenceFrom('section_pr', pr.traversalCount),
        supportingData: {
          // What the card draws: the efforts the engine already held when it
          // found the record, oldest first. Nothing is derived here.
          ...sparkline(pr.recentEfforts, t('insights.data.recentEfforts')),
          sections: [
            {
              sectionId: pr.sectionId,
              sectionName: pr.sectionName,
              bestTime: pr.bestTime,
              // The record's sport, not the section's: the sheet's icon reads
              // this and a run on a much-ridden climb drew a bicycle.
              sportType: pr.sportType,
              traversalCount: pr.traversalCount,
              previewPoints: pr.previewPoints,
            },
          ],
          dataPoints: [
            {
              label: t('insights.data.bestTime'),
              value: formatDuration(pr.bestTime),
              context: 'good' as const,
            },
            {
              label: t('insights.data.daysAgo'),
              value: pr.daysAgo,
              unit: t('insights.data.days'),
            },
          ],
        },
        methodology: {
          name: t('insights.methodology.prDetectionName'),
          description: t('insights.methodology.prDetection'),
        },
        meta: {
          sourceTimestamp: now - pr.daysAgo * DAY_MS,
          comparisonKind: 'self',
          placeName: pr.sectionName,
          sectionId: pr.sectionId,
        },
      })
    );
  }

  return insights;
}
