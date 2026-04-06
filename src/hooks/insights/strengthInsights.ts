import { MUSCLE_DISPLAY_NAMES, type MuscleSlug } from '@/lib/strength/exerciseMuscleMap';
import { buildStrengthBalancePairs, buildStrengthProgression } from '@/lib/strength/analysis';
import type { Insight, StrengthBalancePair, StrengthProgressPoint, StrengthSummary } from '@/types';

const MIN_PROGRESS_SIGNAL = 4;
const MIN_PROGRESS_CHANGE_PCT = 15;

function formatSetCount(value: number): string {
  return value % 1 === 0 ? value.toFixed(0) : value.toFixed(1);
}

function formatRatio(value: number | null): string {
  if (value == null) return 'No signal';
  if (!Number.isFinite(value)) return 'One-sided';
  return `${value.toFixed(value >= 10 ? 0 : 1)}x`;
}

function buildStrengthBalanceInsight(pair: StrengthBalancePair, now: number): Insight {
  const counterpart = pair.dominantSlug === pair.leftSlug ? pair.rightLabel : pair.leftLabel;
  const title =
    pair.status === 'one-sided'
      ? `${pair.label} register a one-sided split`
      : `${pair.dominantLabel ?? pair.leftLabel} carries more volume in ${pair.label.toLowerCase()}`;
  const body =
    pair.status === 'one-sided'
      ? `${pair.dominantLabel ?? pair.leftLabel} represents all of the weighted set volume for ${pair.label.toLowerCase()} across the past 4 weeks.`
      : `${pair.label} averages ${formatRatio(pair.ratio)} in weighted sets in the most recent 4-week window.`;

  return {
    id: `strength_balance-${pair.id}`,
    category: 'strength_balance',
    priority: pair.status === 'watch' ? 3 : 2,
    title,
    subtitle: `${pair.leftLabel} ${formatSetCount(pair.leftWeightedSets)} · ${pair.rightLabel} ${formatSetCount(pair.rightWeightedSets)}`,
    body,
    icon: 'scale-balance',
    iconColor: pair.status === 'watch' ? '#F59E0B' : '#EF4444',
    navigationTarget: '/routes?tab=strength',
    timestamp: now,
    isNew: false,
    supportingData: {
      dataPoints: [
        { label: pair.leftLabel, value: formatSetCount(pair.leftWeightedSets), unit: 'sets' },
        { label: pair.rightLabel, value: formatSetCount(pair.rightWeightedSets), unit: 'sets' },
        { label: 'Ratio', value: formatRatio(pair.ratio) },
        { label: 'Status', value: pair.status === 'watch' ? 'Watch' : 'Imbalanced' },
      ],
      formula: 'Weighted sets per antagonist pair',
      algorithmDescription:
        'Compares weighted set counts across common antagonist pairs. Primary work counts as 1.0 and secondary work counts as 0.5.',
    },
    methodology: {
      name: 'Strength balance check',
      description:
        'Compares weighted set counts across antagonist muscle pairs over the last 4 weeks to flag skewed loading patterns.',
      formula: 'ratio = dominant weighted sets / secondary weighted sets',
    },
  };
}

function buildStrengthProgressionInsight(
  muscleSlug: string,
  monthlyWeightedSets: number,
  points: StrengthProgressPoint[],
  now: number
): Insight | null {
  if (monthlyWeightedSets < MIN_PROGRESS_SIGNAL) return null;

  const progression = buildStrengthProgression(muscleSlug, points);
  const hasRecentVolume = progression.points.some((point) => point.weightedSets > 0);
  const isMeaningfulChange =
    progression.changePct == null
      ? progression.recentAverage > 0 && progression.baselineAverage === 0
      : Math.abs(progression.changePct) >= MIN_PROGRESS_CHANGE_PCT;

  if (!hasRecentVolume || !isMeaningfulChange || progression.trend === 'flat') {
    return null;
  }

  const muscleName = MUSCLE_DISPLAY_NAMES[muscleSlug as MuscleSlug] ?? muscleSlug;
  const title =
    progression.trend === 'up'
      ? `${muscleName} volume gain is visible`
      : `${muscleName} volume eased off`;
  const body =
    progression.changePct == null
      ? `${muscleName} generated most of its recent weighted sets in the current 2 weeks after a quieter earlier period.`
      : `${muscleName} shifted from ${formatSetCount(progression.baselineAverage)} to ${formatSetCount(
          progression.recentAverage
        )} weighted sets in the current 2-week average.`;

  return {
    id: `strength_progression-${muscleSlug}`,
    category: 'strength_progression',
    priority: 3,
    title,
    subtitle:
      progression.changePct == null
        ? 'Last 4 weeks'
        : `${progression.changePct > 0 ? '+' : ''}${Math.round(progression.changePct)}% vs earlier 2 weeks`,
    body,
    icon: progression.trend === 'up' ? 'arm-flex-outline' : 'dumbbell',
    iconColor: progression.trend === 'up' ? '#22C55E' : '#F59E0B',
    navigationTarget: '/routes?tab=strength',
    timestamp: now,
    isNew: false,
    supportingData: {
      dataPoints: [
        { label: 'Recent avg', value: progression.recentAverage, unit: 'sets' },
        { label: 'Earlier avg', value: progression.baselineAverage, unit: 'sets' },
        { label: 'Peak week', value: progression.peakWeightedSets, unit: 'sets' },
        { label: '4-week total', value: formatSetCount(monthlyWeightedSets), unit: 'sets' },
      ],
      sparklineData: progression.points.map((point) => point.weightedSets),
      sparklineLabel: '4-week weighted sets',
      comparisonData: {
        current: {
          label: 'Recent 2 wks',
          value: progression.recentAverage,
          unit: 'sets',
        },
        previous: {
          label: 'Earlier 2 wks',
          value: progression.baselineAverage,
          unit: 'sets',
        },
        change: {
          label: 'Change',
          value:
            progression.changePct == null
              ? 'New signal'
              : `${progression.changePct > 0 ? '+' : ''}${Math.round(progression.changePct)}%`,
          context: 'neutral',
        },
      },
      formula: 'Recent 2-week average vs earlier 2-week average',
      algorithmDescription:
        'Tracks weighted sets per muscle across the last 4 weeks. Primary work counts as 1.0 and secondary work counts as 0.5.',
    },
    methodology: {
      name: 'Strength volume progression',
      description:
        'Compares the recent 2-week average against the earlier 2-week average to detect meaningful changes in weighted set volume.',
    },
  };
}

export function generateStrengthInsights(
  monthlySummary: StrengthSummary | null,
  weeklySummaries: StrengthSummary[],
  now: number
): Insight[] {
  if (!monthlySummary || monthlySummary.activityCount === 0 || weeklySummaries.length === 0) {
    return [];
  }

  const insights: Insight[] = [];

  const balancePair = buildStrengthBalancePairs(monthlySummary.muscleVolumes).find(
    (pair) => pair.status === 'watch' || pair.status === 'imbalanced' || pair.status === 'one-sided'
  );
  if (balancePair) {
    insights.push(buildStrengthBalanceInsight(balancePair, now));
  }

  const progressionCandidates = monthlySummary.muscleVolumes
    .map((muscle) => {
      const points = weeklySummaries.map((summary, index) => {
        const point = summary.muscleVolumes.find((entry) => entry.slug === muscle.slug);
        return {
          label:
            index === weeklySummaries.length - 1
              ? 'This wk'
              : `-${weeklySummaries.length - 1 - index}w`,
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
        now
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
