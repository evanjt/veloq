import type { Insight } from '@/types';

import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '../lib/exerciseMuscleMap';
import { buildStrengthBalancePairs } from '../lib/analysis';
import { formatSetCount } from '../lib/formatting';
import type { StrengthBalancePair, StrengthProgressionRecord, StrengthSummary } from '../types';
import { INSIGHTS_CONFIG, confidenceFrom } from '@/features/insights/lib/config';
import { signalDeltaFrom } from '@/features/insights';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

/**
 * A ratio against an untrained side is not a number, so the engine sends none
 * and the verdict carries that case: `one-sided` is a reading, `insufficient`
 * and the rest are a pair with nothing to divide.
 */
function formatRatio(pair: StrengthBalancePair, t: TFunc): string {
  if (pair.status === 'one-sided') return t('insights.strengthBalance.oneSided');
  if (pair.ratio == null) return t('insights.strengthBalance.noSignal');
  return `${pair.ratio.toFixed(pair.ratio >= 10 ? 0 : 1)}x`;
}

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
          ratio: formatRatio(pair, t),
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
        { label: t('insights.strengthBalance.ratioLabel'), value: formatRatio(pair, t) },
        {
          label: t('insights.strengthBalance.statusLabel'),
          value:
            pair.status === 'watch'
              ? t('insights.strengthBalance.watch')
              : t('insights.strengthBalance.imbalanced'),
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

/**
 * Signal-to-noise delta for R6: how far the recent average sits from the
 * baseline, measured in weekly standard deviations. Ranking progressions on
 * this is what lets the shared pipeline choose between muscles.
 */
function progressionSignalDelta(progression: StrengthProgressionRecord): number | undefined {
  return signalDeltaFrom(
    progression.recentAverage,
    progression.baselineAverage,
    progression.weeklyWeightedSets
  );
}

function buildStrengthProgressionInsight(
  progression: StrengthProgressionRecord,
  monthlyWeightedSets: number,
  now: number,
  t: TFunc
): Insight | null {
  if (monthlyWeightedSets < INSIGHTS_CONFIG.repetition.strength_min_sets) return null;

  const hasRecentVolume = progression.weeklyWeightedSets.some((weightedSets) => weightedSets > 0);
  const isMeaningfulChange =
    progression.changePct == null
      ? progression.recentAverage > 0 && progression.baselineAverage === 0
      : Math.abs(progression.changePct) >= INSIGHTS_CONFIG.thresholds.minProgressChangePct;

  if (!hasRecentVolume || !isMeaningfulChange || progression.trend === 'flat') {
    return null;
  }

  const muscleSlug = progression.muscleSlug;
  const muscleName = MUSCLE_DISPLAY_NAMES[muscleSlug as MuscleSlug] ?? muscleSlug;
  const title =
    progression.trend === 'up'
      ? t('insights.strengthProgression.upTitle', { muscle: muscleName })
      : t('insights.strengthProgression.downTitle', { muscle: muscleName });
  const body =
    progression.changePct == null
      ? t('insights.strengthProgression.newVolumeBody', { muscle: muscleName })
      : t('insights.strengthProgression.shiftBody', {
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
    iconTone:
      progression.trend === 'up'
        ? 'positive'
        : progression.trend === 'down'
          ? 'negative'
          : 'neutral',
    navigationTarget: '/insights?tab=strength',
    timestamp: now,
    isNew: false,
    meta: {
      sourceTimestamp: now,
      comparisonKind: 'self',
      signalDelta: progressionSignalDelta(progression),
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
  const dominantName = dominant
    ? (MUSCLE_DISPLAY_NAMES[dominant.slug as MuscleSlug] ?? dominant.slug)
    : null;
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

  // Surface a snapshot only when there is enough volume to be informative -
  // mirrors the per-muscle gate used by the other strength insights.
  if (monthlySummary.totalSets > INSIGHTS_CONFIG.repetition.strength_min_sets) {
    insights.push(buildStrengthSnapshotInsight(monthlySummary, now, t));
  }

  const balancePair = buildStrengthBalancePairs(monthlySummary.balance).find(
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
