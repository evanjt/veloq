import type { Insight } from '@/types';
import { trendVerdict, verdictRung } from '@/shared/format/trend';

import { muscleName as nameOf } from '../lib/muscleNames';
import { buildStrengthBalancePairs } from '../lib/analysis';
import { balanceStatusLabelKey, formatBalanceRatio, formatSetCount } from '../lib/formatting';
import type { StrengthBalancePair, StrengthProgressionRecord, StrengthSummary } from '../types';
import { INSIGHTS_CONFIG, confidenceFrom } from '@/features/insights';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

function buildStrengthBalanceInsight(pair: StrengthBalancePair, now: number, t: TFunc): Insight {
  const dominant = pair.dominantLabel ?? pair.leftLabel;
  const title =
    pair.status === 'one-sided'
      ? t('insights.strengthBalance.oneSidedTitle', { pair: pair.label })
      : t('insights.strengthBalance.dominantTitle', { dominant, pair: pair.label });
  const body =
    pair.status === 'one-sided'
      ? t('insights.strengthBalance.oneSidedBody', { dominant, pair: pair.label })
      : t('insights.strengthBalance.ratioBody', {
          pair: pair.label,
          ratio: formatBalanceRatio(pair, t),
        });

  return {
    id: `strength_balance-${pair.id}`,
    category: 'strength_balance',
    priority: pair.status === 'watch' ? 3 : 2,
    // The sets on both sides are the whole population: a ratio from two sets
    // says far less about a habit than the same ratio from twenty.
    confidence: confidenceFrom('strength_balance', pair.leftWeightedSets + pair.rightWeightedSets),
    title,
    subtitle: `${pair.leftLabel} ${formatSetCount(pair.leftWeightedSets)} · ${pair.rightLabel} ${formatSetCount(pair.rightWeightedSets)}`,
    body,
    icon: 'scale-balance',
    iconTone: pair.status === 'watch' ? 'caution' : 'negative',
    navigationTarget: '/insights?tab=strength',
    timestamp: now,
    isNew: false,
    meta: {
      sourceTimestamp: now,
      comparisonKind: 'self',
    },
    supportingData: {
      dataPoints: [
        {
          label: pair.leftLabel,
          value: formatSetCount(pair.leftWeightedSets),
          unit: t('strength.sets'),
        },
        {
          label: pair.rightLabel,
          value: formatSetCount(pair.rightWeightedSets),
          unit: t('strength.sets'),
        },
        {
          key: 'balanceRatio',
          label: t('insights.strengthBalance.ratioLabel'),
          value: formatBalanceRatio(pair, t),
        },
        {
          label: t('insights.strengthBalance.statusLabel'),
          value: t(balanceStatusLabelKey(pair.status)),
        },
      ],
      formula: t('insights.strengthBalance.formula'),
      algorithmDescription: t('insights.strengthBalance.algorithm'),
    },
    methodology: {
      name: t('insights.strengthBalance.methodologyName'),
      description: t('insights.strengthBalance.methodologyDescription'),
      formula: t('insights.strengthBalance.ratioFormula'),
    },
  };
}

function buildStrengthProgressionInsight(
  progression: StrengthProgressionRecord,
  monthlyWeightedSets: number,
  now: number,
  t: TFunc
): Insight | null {
  if (monthlyWeightedSets < INSIGHTS_CONFIG.repetition.strength_min_sets) return null;

  const hasRecentVolume = progression.weeklyWeightedSets.some((weightedSets) => weightedSets > 0);

  // The engine's trend is the verdict on the change; it is not re-tested here.
  if (!hasRecentVolume || progression.trend === 'flat') {
    return null;
  }

  // Weekly sets move with no judgement: the arrow points, the colour stays neutral.
  const verdict = trendVerdict('weekSets', progression.trend);
  const muscleSlug = progression.muscleSlug;
  const muscleName = nameOf(muscleSlug, t);
  const title =
    progression.trend === 'up'
      ? t('insights.strengthProgression.upTitle', { muscle: muscleName })
      : t('insights.strengthProgression.downTitle', { muscle: muscleName });
  // Both averages whatever the baseline: a rise from zero has no percentage,
  // and the two numbers are still the comparison.
  const body = t('insights.strengthProgression.shiftBody', {
    muscle: muscleName,
    from: formatSetCount(progression.baselineAverage),
    to: formatSetCount(progression.recentAverage),
  });

  return {
    id: `strength_progression-${muscleSlug}`,
    category: 'strength_progression',
    priority: 3,
    // The weeks with any volume in them, not every week in the window: a
    // fortnight of training does not become six weeks of evidence by sitting
    // inside a six-week window.
    confidence: confidenceFrom(
      'strength_progression',
      progression.weeklyWeightedSets.filter((weightedSets) => weightedSets > 0).length
    ),
    title,
    subtitle:
      progression.changePct == null
        ? t('strength.last4Weeks')
        : t('insights.strengthProgression.vsEarlier', {
            change: `${progression.changePct > 0 ? '+' : ''}${Math.round(progression.changePct)}`,
          }),
    body,
    icon: progression.trend === 'up' ? 'arm-flex-outline' : 'dumbbell',
    // Flat is not a warning. It used to share amber with a fall, so a steady
    // month read as a problem.
    iconTone: verdictRung(verdict),
    navigationTarget: '/insights?tab=strength',
    timestamp: now,
    isNew: false,
    meta: {
      sourceTimestamp: now,
      comparisonKind: 'self',
      // The engine's reading, the same rule the HRV and efficiency trends
      // are scored on, so the ranker compares like with like.
      signalDelta: progression.signalDelta ?? undefined,
    },
    supportingData: {
      dataPoints: [
        {
          label: t('strength.recentAvg'),
          value: progression.recentAverage,
          unit: t('strength.sets'),
        },
        {
          label: t('strength.earlierAvg'),
          value: progression.baselineAverage,
          unit: t('strength.sets'),
        },
        {
          label: t('strength.peakWeek'),
          value: progression.peakWeightedSets,
          unit: t('strength.sets'),
        },
        {
          label: t('insights.strengthProgression.fourWeekTotal'),
          value: formatSetCount(monthlyWeightedSets),
          unit: t('strength.sets'),
        },
      ],
      sparklineData: progression.weeklyWeightedSets,
      sparklineLabel: t('insights.strengthProgression.sparklineLabel'),
      // The engine's own direction, past its change threshold, judged by the
      // metric's polarity.
      trend: {
        direction: progression.trend,
        verdict,
      },
      comparisonData: {
        current: {
          label: t('insights.strengthProgression.recent2Weeks'),
          value: progression.recentAverage,
          unit: t('strength.sets'),
        },
        previous: {
          label: t('insights.strengthProgression.earlier2Weeks'),
          value: progression.baselineAverage,
          unit: t('strength.sets'),
        },
        change: {
          label: t('insights.strengthProgression.changeLabel'),
          value:
            progression.changePct == null
              ? t('strength.newSignal')
              : `${progression.changePct > 0 ? '+' : ''}${Math.round(progression.changePct)}%`,
          context: 'neutral',
        },
      },
      formula: t('insights.strengthProgression.formula'),
      algorithmDescription: t('insights.strengthProgression.algorithm'),
    },
    methodology: {
      name: t('insights.strengthProgression.methodologyName'),
      description: t('insights.strengthProgression.methodologyDescription'),
    },
  };
}

function buildStrengthSnapshotInsight(summary: StrengthSummary, now: number, t: TFunc): Insight {
  const dominant = [...summary.muscleVolumes].sort((a, b) => b.weightedSets - a.weightedSets)[0];
  const dominantName = dominant ? nameOf(dominant.slug, t) : null;
  const subtitle = dominantName
    ? t('insights.strengthSnapshot.subtitleWithTop', {
        sessions: summary.activityCount,
        sets: summary.totalSets,
        muscle: dominantName,
      })
    : t('insights.strengthSnapshot.subtitle', {
        sessions: summary.activityCount,
        sets: summary.totalSets,
      });

  return {
    id: 'strength_snapshot',
    category: 'strength_progression',
    priority: 4,
    confidence: confidenceFrom('strength_progression', summary.activityCount),
    title: t('insights.strengthSnapshot.title', { count: summary.activityCount }),
    subtitle,
    body: t('insights.strengthSnapshot.body', {
      sets: summary.totalSets,
      groups: summary.muscleVolumes.length,
    }),
    icon: 'dumbbell',
    iconTone: 'neutral',
    navigationTarget: '/insights?tab=strength',
    timestamp: now,
    isNew: false,
    meta: {
      sourceTimestamp: now,
      comparisonKind: 'self',
    },
    supportingData: {
      dataPoints: [
        { label: t('insights.strengthSnapshot.sessionsLabel'), value: summary.activityCount },
        { label: t('insights.strengthSnapshot.setsLabel'), value: summary.totalSets },
        {
          label: t('insights.strengthSnapshot.muscleGroupsLabel'),
          value: summary.muscleVolumes.length,
        },
      ],
      formula: t('insights.strengthSnapshot.formula'),
      algorithmDescription: t('insights.strengthSnapshot.algorithm'),
    },
    methodology: {
      name: t('strength.snapshot'),
      description: t('insights.strengthSnapshot.methodologyDescription'),
    },
  };
}

export function generateStrengthInsights(
  monthlySummary: StrengthSummary | null,
  weeklySummaries: StrengthSummary[],
  progressions: StrengthProgressionRecord[],
  now: number,
  t: TFunc
): Insight[] {
  if (!monthlySummary || monthlySummary.activityCount === 0 || weeklySummaries.length === 0) {
    return [];
  }

  const insights: Insight[] = [];

  // Surface a snapshot only when there is enough volume to be informative,
  // passing at the same minimum as the per-muscle gate.
  if (monthlySummary.totalSets >= INSIGHTS_CONFIG.repetition.strength_min_sets) {
    insights.push(buildStrengthSnapshotInsight(monthlySummary, now, t));
  }

  const balancePair = buildStrengthBalancePairs(monthlySummary.balance, t).find(
    (pair) => pair.status === 'watch' || pair.status === 'imbalanced' || pair.status === 'one-sided'
  );
  if (balancePair) {
    insights.push(buildStrengthBalanceInsight(balancePair, now, t));
  }

  const monthlyWeightedSets = new Map(
    monthlySummary.muscleVolumes.map((muscle) => [muscle.slug, muscle.weightedSets])
  );
  for (const progression of progressions) {
    const insight = buildStrengthProgressionInsight(
      progression,
      monthlyWeightedSets.get(progression.muscleSlug) ?? 0,
      now,
      t
    );
    if (insight) insights.push(insight);
  }

  return insights;
}
