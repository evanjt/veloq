import { INSIGHTS_CONFIG } from '@/features/insights/lib/config';
import type { Insight } from '@/types';

import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '../lib/exerciseMuscleMap';
import { buildStrengthBalancePairs, buildStrengthProgression } from '../lib/analysis';
import { formatSetCount } from '../lib/formatting';
import type { StrengthBalancePair, StrengthProgressPoint, StrengthSummary } from '../types';
import { colors } from '@/theme';

type TFunc = (key: string, params?: Record<string, string | number>) => string;

function formatRatio(value: number | null, t: TFunc): string {
  if (value == null) return t('insights.strengthBalance.noSignal');
  if (!Number.isFinite(value)) return t('insights.strengthBalance.oneSided');
  return `${value.toFixed(value >= 10 ? 0 : 1)}x`;
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
          ratio: formatRatio(pair.ratio, t),
        });

  return {
    id: `strength_balance-${pair.id}`,
    category: 'strength_balance',
    priority: pair.status === 'watch' ? 3 : 2,
    title,
    subtitle: `${pair.leftLabel} ${formatSetCount(pair.leftWeightedSets)} · ${pair.rightLabel} ${formatSetCount(pair.rightWeightedSets)}`,
    body,
    icon: 'scale-balance',
    iconColor: pair.status === 'watch' ? colors.warning : colors.error,
    navigationTarget: '/routes?tab=strength',
    timestamp: now,
    isNew: false,
    meta: {
      sourceTimestamp: now,
      comparisonKind: 'self',
      specificity: { hasNumber: true, hasPlace: false, hasDate: false },
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
        { label: t('insights.strengthBalance.ratioLabel'), value: formatRatio(pair.ratio, t) },
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

function buildStrengthProgressionInsight(
  muscleSlug: string,
  monthlyWeightedSets: number,
  points: StrengthProgressPoint[],
  now: number,
  t: TFunc
): Insight | null {
  if (monthlyWeightedSets < INSIGHTS_CONFIG.repetition.strength_min_sets) return null;

  const progression = buildStrengthProgression(muscleSlug, points);
  const hasRecentVolume = progression.points.some((point) => point.weightedSets > 0);
  const isMeaningfulChange =
    progression.changePct == null
      ? progression.recentAverage > 0 && progression.baselineAverage === 0
      : Math.abs(progression.changePct) >= INSIGHTS_CONFIG.thresholds.minProgressChangePct;

  if (!hasRecentVolume || !isMeaningfulChange || progression.trend === 'flat') {
    return null;
  }

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
    title,
    subtitle:
      progression.changePct == null
        ? t('strength.last4Weeks')
        : t('insights.strengthProgression.vsEarlier', {
            change: `${progression.changePct > 0 ? '+' : ''}${Math.round(progression.changePct)}`,
          }),
    body,
    icon: progression.trend === 'up' ? 'arm-flex-outline' : 'dumbbell',
    iconColor: progression.trend === 'up' ? colors.success : colors.warning,
    navigationTarget: '/routes?tab=strength',
    timestamp: now,
    isNew: false,
    meta: {
      sourceTimestamp: now,
      comparisonKind: 'self',
      specificity: {
        hasNumber: true,
        hasPlace: false,
        hasDate: true,
      },
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
      sparklineData: progression.points.map((point) => point.weightedSets),
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
    title: t('insights.strengthSnapshot.title', { count: summary.activityCount }),
    subtitle,
    body: t('insights.strengthSnapshot.body', {
      sets: summary.totalSets,
      groups: summary.muscleVolumes.length,
    }),
    icon: 'dumbbell',
    iconColor: colors.gray500,
    navigationTarget: '/routes?tab=strength',
    timestamp: now,
    isNew: false,
    meta: {
      sourceTimestamp: now,
      comparisonKind: 'self',
      specificity: { hasNumber: true, hasPlace: false, hasDate: false },
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

  const balancePair = buildStrengthBalancePairs(monthlySummary.muscleVolumes).find(
    (pair) => pair.status === 'watch' || pair.status === 'imbalanced' || pair.status === 'one-sided'
  );
  if (balancePair) {
    insights.push(buildStrengthBalanceInsight(balancePair, now, t));
  }

  const progressionCandidates = monthlySummary.muscleVolumes
    .map((muscle) => {
      const points = weeklySummaries.map((summary, index) => {
        const point = summary.muscleVolumes.find((entry) => entry.slug === muscle.slug);
        return {
          label:
            index === weeklySummaries.length - 1
              ? t('insights.strengthProgression.thisWeek')
              : t('insights.strengthProgression.weeksAgo', {
                  n: weeklySummaries.length - 1 - index,
                }),
          startTs: 0,
          endTs: 0,
          weightedSets: point?.weightedSets ?? 0,
          activityCount: summary.activityCount,
        };
      });
      const insight = buildStrengthProgressionInsight(
        muscle.slug,
        muscle.weightedSets,
        points,
        now,
        t
      );
      const progression = buildStrengthProgression(muscle.slug, points);
      const score =
        progression.changePct == null ? progression.recentAverage : Math.abs(progression.changePct);
      return insight ? { insight, score } : null;
    })
    .filter((candidate): candidate is { insight: Insight; score: number } => candidate != null)
    .sort((a, b) => b.score - a.score);

  if (progressionCandidates.length > 0) {
    insights.push(progressionCandidates[0].insight);
  }

  return insights.sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp);
}
