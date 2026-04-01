import type { Insight } from '@/types';
import { formatDuration } from '@/lib';

/**
 * Stale PR / Opportunity Detection
 *
 * Surfaces sections where the user's PR might be beatable because their
 * fitness has improved since the PR was set. This is pattern recognition,
 * not coaching:
 *
 * 1. FTP increased (fact)
 * 2. Section hasn't been visited recently (fact)
 * 3. PR was set at a lower FTP (reasonable inference from dates)
 * 4. Therefore, the PR might be beatable (observation, not prescription)
 *
 * Framed as curiosity: "Section X: PR set at 155W FTP, you're now at 168W"
 */

// ---------------------------------------------------------------------------
// Input types — mirrors structures from generateInsights.ts
// ---------------------------------------------------------------------------

export interface StalePRSectionData {
  sectionId: string;
  sectionName: string;
  bestTimeSecs: number;
  traversalCount: number;
  /** Timestamp (seconds since epoch) of the most recent traversal, if known */
  lastTraversalTs?: number;
  /** Sport type: 'Run', 'Ride', etc. */
  sportType?: string;
}

export interface StalePRFtpTrend {
  latestFtp: number | undefined;
  latestDate: bigint | number | undefined;
  previousFtp: number | undefined;
  previousDate: bigint | number | undefined;
}

export interface StalePRRecentPR {
  sectionId: string;
  sectionName: string;
  bestTime: number;
  daysAgo: number;
}

export interface StalePRPaceTrend {
  latestPace: number | undefined;
  latestDate: bigint | number | undefined;
  previousPace: number | undefined;
  previousDate: bigint | number | undefined;
}

export interface StalePRInput {
  sections: StalePRSectionData[];
  ftpTrend: StalePRFtpTrend | null;
  /** Backward-compatible alias for running pace trend. */
  paceTrend?: StalePRPaceTrend | null;
  runPaceTrend?: StalePRPaceTrend | null;
  swimPaceTrend?: StalePRPaceTrend | null;
  recentPRs: StalePRRecentPR[];
}

export interface StalePROpportunity {
  sectionId: string;
  sectionName: string;
  bestTimeSecs: number;
  /** 'power' for cycling (FTP), 'pace' for running */
  fitnessMetric: 'power' | 'pace';
  currentValue: number;
  previousValue: number;
  gainPercent: number;
  /** Unit label: 'W' for power, 'min/km' for pace */
  unit: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Minimum days since last traversal to consider a section "stale" */
const STALE_THRESHOLD_DAYS = 30;

/** Minimum FTP gain (%) to flag an opportunity */
const MIN_FTP_GAIN_PERCENT = 3;

/** Maximum opportunities to return */
const MAX_OPPORTUNITIES = 3;

// ---------------------------------------------------------------------------
// Detection logic
// ---------------------------------------------------------------------------

/** Check if a fitness metric has improved enough to flag opportunities */
function getFitnessImprovement(
  sportType: string | undefined,
  ftpTrend: StalePRFtpTrend | null,
  runPaceTrend: StalePRPaceTrend | null,
  swimPaceTrend: StalePRPaceTrend | null
): {
  metric: 'power' | 'pace';
  current: number;
  previous: number;
  gain: number;
  unit: string;
} | null {
  const isRunning = sportType === 'Run' || sportType === 'VirtualRun' || sportType === 'TrailRun';
  const isSwimming = sportType === 'Swim' || sportType === 'OpenWaterSwim';
  const isCycling =
    sportType === 'Ride' ||
    sportType === 'VirtualRide' ||
    sportType === 'MountainBikeRide' ||
    sportType === 'GravelRide' ||
    sportType === 'Handcycle' ||
    sportType === 'Velomobile';
  const paceTrend = isRunning ? runPaceTrend : isSwimming ? swimPaceTrend : null;

  if ((isRunning || isSwimming) && paceTrend) {
    const cur = paceTrend.latestPace;
    const prev = paceTrend.previousPace;
    if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
    // For pace, lower is better — improvement means current < previous
    if (cur >= prev) return null;
    const gainPercent = ((prev - cur) / prev) * 100;
    if (gainPercent < MIN_FTP_GAIN_PERCENT) return null;
    return {
      metric: 'pace',
      current: cur,
      previous: prev,
      gain: Math.round(gainPercent * 10) / 10,
      unit: isSwimming ? 'min/100m' : 'min/km',
    };
  }

  if (isCycling && ftpTrend) {
    const cur = ftpTrend.latestFtp;
    const prev = ftpTrend.previousFtp;
    if (cur == null || prev == null || !Number.isFinite(cur) || !Number.isFinite(prev)) return null;
    if (cur <= prev) return null;
    const gainPercent = ((cur - prev) / prev) * 100;
    if (gainPercent < MIN_FTP_GAIN_PERCENT) return null;
    return {
      metric: 'power',
      current: cur,
      previous: prev,
      gain: Math.round(gainPercent * 10) / 10,
      unit: 'W',
    };
  }

  return null;
}

/**
 * Detect sections where a PR might be beatable due to fitness improvement.
 *
 * Sport-aware: uses FTP for cycling sections, pace trend for running sections.
 * Only flags sections that haven't been visited in 30+ days and where the
 * relevant fitness metric has improved by 3%+.
 */
export function detectStalePROpportunities(input: StalePRInput): StalePROpportunity[] {
  const { sections, ftpTrend, paceTrend, runPaceTrend, swimPaceTrend, recentPRs } = input;
  const resolvedRunPaceTrend = runPaceTrend ?? paceTrend ?? null;

  // No fitness data at all → nothing to flag
  if (!ftpTrend && !resolvedRunPaceTrend && !swimPaceTrend) return [];

  // Build a set of section IDs that had a recent PR (within 30 days)
  const recentPRSectionIds = new Set(
    recentPRs.filter((pr) => pr.daysAgo <= STALE_THRESHOLD_DAYS).map((pr) => pr.sectionId)
  );

  const now = Date.now() / 1000;
  const opportunities: StalePROpportunity[] = [];

  for (const section of sections) {
    if (recentPRSectionIds.has(section.sectionId)) continue;
    if (section.traversalCount === 0 || !Number.isFinite(section.bestTimeSecs)) continue;

    // Check staleness
    if (section.lastTraversalTs != null && Number.isFinite(section.lastTraversalTs)) {
      const daysSinceLast = (now - section.lastTraversalTs) / 86400;
      if (daysSinceLast < STALE_THRESHOLD_DAYS) continue;
    }

    // Get sport-appropriate fitness improvement
    const improvement = getFitnessImprovement(
      section.sportType,
      ftpTrend,
      resolvedRunPaceTrend,
      swimPaceTrend ?? null
    );
    if (!improvement) continue;

    opportunities.push({
      sectionId: section.sectionId,
      sectionName: section.sectionName,
      bestTimeSecs: section.bestTimeSecs,
      fitnessMetric: improvement.metric,
      currentValue: improvement.current,
      previousValue: improvement.previous,
      gainPercent: improvement.gain,
      unit: improvement.unit,
    });
  }

  opportunities.sort((a, b) => {
    const aSection = sections.find((s) => s.sectionId === a.sectionId);
    const bSection = sections.find((s) => s.sectionId === b.sectionId);
    return (bSection?.traversalCount ?? 0) - (aSection?.traversalCount ?? 0);
  });

  return opportunities.slice(0, MAX_OPPORTUNITIES);
}

// ---------------------------------------------------------------------------
// Insight formatting
// ---------------------------------------------------------------------------

/**
 * Convert a StalePROpportunity into an Insight object suitable for the
 * insights panel and InsightLine rotation.
 */
export function stalePROpportunityToInsight(
  opportunity: StalePROpportunity,
  t: (key: string, params?: Record<string, string | number>) => string,
  now?: number
): Insight {
  const timestamp = now ?? Date.now();
  const prTime = formatDuration(opportunity.bestTimeSecs);

  const isPower = opportunity.fitnessMetric === 'power';
  const metricLabel = isPower ? 'FTP' : 'Pace';
  const currentStr = isPower
    ? `${Math.round(opportunity.currentValue)}${opportunity.unit}`
    : formatDuration(opportunity.currentValue);
  const previousStr = isPower
    ? `${Math.round(opportunity.previousValue)}${opportunity.unit}`
    : formatDuration(opportunity.previousValue);

  return {
    id: `stale_pr-${opportunity.sectionId}`,
    category: 'stale_pr',
    priority: 2,
    title: t('insights.stalePr.title', { section: opportunity.sectionName }),
    subtitle: `PR ${prTime} at ${metricLabel} ${previousStr}, now ${currentStr} (+${opportunity.gainPercent}%)`,
    icon: 'lightning-bolt',
    iconColor: '#FF9800',
    body: `${opportunity.sectionName}: PR set at ${metricLabel} ${previousStr}. Current ${metricLabel}: ${currentStr}.`,
    navigationTarget: `/section/${opportunity.sectionId}`,
    timestamp,
    isNew: true,
    supportingData: {
      dataPoints: [
        {
          label: `Current ${metricLabel}`,
          value: currentStr,
        },
        {
          label: `${metricLabel} at PR`,
          value: previousStr,
        },
        {
          label: `${metricLabel} gain`,
          value: `+${opportunity.gainPercent}%`,
          context: 'good',
        },
        {
          label: t('insights.stalePr.prTime'),
          value: prTime,
        },
      ],
      formula: `${metricLabel} gain = ${isPower ? `(${Math.round(opportunity.currentValue)} - ${Math.round(opportunity.previousValue)}) / ${Math.round(opportunity.previousValue)}` : `(${previousStr} - ${currentStr}) / ${previousStr}`} = +${opportunity.gainPercent}%`,
      algorithmDescription: t('insights.stalePr.methodology'),
    },
    methodology: {
      name: `${metricLabel}-PR cross-reference`,
      description: t('insights.stalePr.methodology'),
    },
  };
}
