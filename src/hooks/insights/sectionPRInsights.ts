import type { Insight, InsightMethodology, InsightSupportingData } from '@/types';
import { formatDuration } from '@/lib';
import { brand } from '@/theme/colors';

interface SectionPR {
  sectionId: string;
  sectionName: string;
  bestTime: number;
  daysAgo: number;
}

type TFunc = (key: string, params?: Record<string, string | number>) => string;

const MAX_PR_INSIGHTS = 3;

function makeInsight(fields: {
  id: string;
  category: Insight['category'];
  priority: Insight['priority'];
  icon: string;
  iconColor: string;
  title: string;
  subtitle?: string;
  body?: string;
  navigationTarget?: string;
  timestamp: number;
  supportingData?: InsightSupportingData;
  methodology?: InsightMethodology;
  confidence?: number;
}): Insight {
  return { ...fields, isNew: false } as Insight;
}

export function generateSectionPRInsights(
  recentPRs: SectionPR[],
  now: number,
  t: TFunc
): Insight[] {
  if (!recentPRs || recentPRs.length === 0) return [];

  const insights: Insight[] = [];
  const prs = recentPRs.slice(0, MAX_PR_INSIGHTS);

  for (const pr of prs) {
    if (!pr.sectionId || !pr.sectionName || !Number.isFinite(pr.bestTime)) continue;
    insights.push(
      makeInsight({
        id: `section_pr-${pr.sectionId}`,
        category: 'section_pr',
        priority: 1,
        icon: 'trophy-outline',
        iconColor: brand.orange,
        title: t('insights.sectionPr', { name: pr.sectionName }),
        subtitle: t('insights.sectionPrSubtitle', {
          time: formatDuration(pr.bestTime),
          daysAgo: pr.daysAgo,
        }),
        navigationTarget: `/section/${pr.sectionId}`,
        timestamp: now,
        supportingData: {
          sections: [
            {
              sectionId: pr.sectionId,
              sectionName: pr.sectionName,
              bestTime: pr.bestTime,
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
      })
    );
  }

  return insights;
}
