import type { Insight, SeriesPoint } from '../types';
import { formatDuration, formatPaceCompact, formatSwimPace } from '@/shared/format/format';
import type { StalePrOpportunity as EngineStalePrOpportunity } from 'veloqrs';
import { confidenceFrom } from '../lib/config';
import { sparkline } from '../lib/sparkline';

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
// Input types - mirrors structures from generateInsights.ts
// ---------------------------------------------------------------------------

export interface StalePRSectionData {
  sectionId: string;
  sectionName: string;
  bestTimeSecs: number;
  traversalCount: number;
  /** Days since the most recent traversal. The engine reports days, not an
   *  instant, so this mirrors the unit rather than converting. */
  daysSinceLast?: number;
  /** Sport type: 'Run', 'Ride', etc. */
  sportType?: string;
}

export interface StalePRFtpTrend {
  latestFtp?: number;
  latestDate?: bigint | number;
  previousFtp?: number;
  previousDate?: bigint | number;
}

export interface StalePRPaceTrend {
  latestPace?: number;
  latestDate?: bigint | number;
  previousPace?: number;
  previousDate?: bigint | number;
}

export interface StalePRInput {
  sections: StalePRSectionData[];
  ftpTrend: StalePRFtpTrend | null;
  /** Backward-compatible alias for running pace trend. */
  paceTrend?: StalePRPaceTrend | null;
  runPaceTrend?: StalePRPaceTrend | null;
  swimPaceTrend?: StalePRPaceTrend | null;
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
  /** Unit label: 'W' for power, '/km' for running, '/100m' for swimming */
  unit: string;
  /** Days since the last traversal. Feeds the recency gate. */
  daysSinceLast: number;
  /** Lifetime traversals. Feeds the repetition gate. */
  traversalCount: number;
  /** The sport the section was ranked under, which the group card names. */
  sportType?: string;
  /** The last efforts on the section, oldest first, for the card's graphic. */
  recentEfforts?: SeriesPoint[];
}

// ---------------------------------------------------------------------------
// Insight formatting
// ---------------------------------------------------------------------------

/**
 * Convert a StalePROpportunity into an Insight object suitable for the
 * insights panel.
 */
export function stalePROpportunityToInsight(
  opportunity: StalePROpportunity,
  t: (key: string, params?: Record<string, string | number>) => string,
  now?: number
): Insight {
  const timestamp = now ?? Date.now();
  const prTime = formatDuration(opportunity.bestTimeSecs);

  const isPower = opportunity.fitnessMetric === 'power';
  const isSwimPace = opportunity.unit === '/100m';
  const metricLabel = isPower
    ? t('insights.stalePr.metricCyclingFtp')
    : isSwimPace
      ? t('insights.stalePr.metricSwimCss')
      : t('insights.stalePr.metricRunningThreshold');
  const currentStr = isPower
    ? `${Math.round(opportunity.currentValue)}${opportunity.unit}`
    : isSwimPace
      ? formatSwimPace(opportunity.currentValue)
      : formatPaceCompact(opportunity.currentValue);
  const previousStr = isPower
    ? `${Math.round(opportunity.previousValue)}${opportunity.unit}`
    : isSwimPace
      ? formatSwimPace(opportunity.previousValue)
      : formatPaceCompact(opportunity.previousValue);
  const displayedCurrent = isPower ? currentStr : `${currentStr}${opportunity.unit}`;
  const displayedPrevious = isPower ? previousStr : `${previousStr}${opportunity.unit}`;

  return {
    id: `stale_pr-${opportunity.sectionId}`,
    category: 'stale_pr',
    priority: 2,
    // The lifetime traversals are what makes a stale record worth chasing:
    // one that stood over two visits is a weaker claim than one over twenty.
    confidence: confidenceFrom('stale_pr', opportunity.traversalCount),
    title: t('insights.stalePr.title', { section: opportunity.sectionName }),
    subtitle: t('insights.stalePr.subtitle', {
      prTime,
      metric: metricLabel,
      previous: displayedPrevious,
      current: displayedCurrent,
      gainPercent: opportunity.gainPercent,
    }),
    icon: 'lightning-bolt',
    iconTone: 'opportunity',
    body: t('insights.stalePr.body', {
      section: opportunity.sectionName,
      metric: metricLabel,
      previous: displayedPrevious,
      current: displayedCurrent,
    }),
    navigationTarget: `/section/${opportunity.sectionId}`,
    timestamp,
    isNew: true,
    meta: {
      comparisonKind: 'self',
      repetitionCount: opportunity.traversalCount,
      // The age of the last traversal, not of the card. The recency gate reads
      // this, and stamping it with `now` would age every card at zero days.
      sourceTimestamp: timestamp - opportunity.daysSinceLast * 86_400_000,
      placeName: opportunity.sectionName,
      sectionId: opportunity.sectionId,
    },
    supportingData: {
      ...sparkline(opportunity.recentEfforts, t('insights.data.recentEfforts')),
      dataPoints: [
        {
          label: t('insights.stalePr.currentMetric', { metric: metricLabel }),
          value: currentStr,
          unit: isPower ? undefined : opportunity.unit,
        },
        {
          label: t('insights.stalePr.prMetric', { metric: metricLabel }),
          value: previousStr,
          unit: isPower ? undefined : opportunity.unit,
        },
        {
          label: t('insights.stalePr.metricGain', { metric: metricLabel }),
          value: `+${opportunity.gainPercent}%`,
          context: 'good',
        },
        {
          label: t('insights.stalePr.prTime'),
          value: prTime,
        },
      ],
      formula: isPower
        ? `${metricLabel} gain = (${Math.round(opportunity.currentValue)} - ${Math.round(opportunity.previousValue)}) / ${Math.round(opportunity.previousValue)} = +${opportunity.gainPercent}%`
        : `Threshold speed gain = (${opportunity.currentValue.toFixed(2)} - ${opportunity.previousValue.toFixed(2)}) / ${opportunity.previousValue.toFixed(2)} = +${opportunity.gainPercent}%`,
      algorithmDescription: t('insights.stalePr.methodology'),
    },
    methodology: {
      name: t('insights.methodology.stalePrCrossRefName', { metric: metricLabel }),
      description: t('insights.stalePr.methodology'),
    },
  };
}

// ---------------------------------------------------------------------------
// Group-card builder (used when multiple opportunities exist)
// ---------------------------------------------------------------------------

const MAX_STALE_PR_SECTIONS_IN_BODY = 3;

/**
 * Generate stale-PR insights: single card when 1 opportunity, group card when 2+.
 *
 * The engine does the whole filter, sort and cap from SQLite-resident FTP and
 * pace trends and ranked-section metadata, so TS never sees the raw candidates
 * and never decides which ones qualify. The rows ride the insights bundle: this
 * used to make an engine call of its own on top of the heaviest read in the
 * tree, and pass back the sections to exclude, which the engine can see for
 * itself in the `recentPrs` of the same bundle.
 */
export function generateStalePRInsights(
  opportunities: readonly EngineStalePrOpportunity[] | undefined,
  t: (key: string, params?: Record<string, string | number>) => string,
  now: number
): Insight[] {
  const filtered: StalePROpportunity[] = (opportunities ?? []).map((r) => ({
    sectionId: r.sectionId,
    sectionName: r.sectionName,
    bestTimeSecs: r.bestTimeSecs,
    daysSinceLast: r.daysSinceLast,
    traversalCount: r.traversalCount,
    fitnessMetric: r.fitnessMetric === 'power' ? 'power' : 'pace',
    currentValue: r.currentValue,
    previousValue: r.previousValue,
    gainPercent: r.gainPercent,
    unit: r.unit,
    sportType: r.sportType,
  }));

  if (filtered.length === 0) return [];
  if (filtered.length === 1) return [stalePROpportunityToInsight(filtered[0], t, now)];

  const powerOpps = filtered.filter((o) => o.fitnessMetric === 'power');
  const runPaceOpps = filtered.filter((o) => o.fitnessMetric === 'pace' && o.unit === '/km');
  const swimPaceOpps = filtered.filter((o) => o.fitnessMetric === 'pace' && o.unit === '/100m');
  const subtitleParts: string[] = [];
  if (powerOpps.length > 0) {
    const p = powerOpps[0];
    subtitleParts.push(`FTP: ${Math.round(p.previousValue)}W → ${Math.round(p.currentValue)}W`);
  }
  if (runPaceOpps.length > 0) {
    const p = runPaceOpps[0];
    subtitleParts.push(
      `Run threshold: ${formatPaceCompact(p.previousValue)}${p.unit} → ${formatPaceCompact(p.currentValue)}${p.unit}`
    );
  }
  if (swimPaceOpps.length > 0) {
    const p = swimPaceOpps[0];
    subtitleParts.push(
      `Swim threshold: ${formatSwimPace(p.previousValue)}${p.unit} → ${formatSwimPace(p.currentValue)}${p.unit}`
    );
  }

  return [
    {
      id: 'stale_pr-group',
      category: 'stale_pr',
      priority: 2,
      // The group stands on the thinnest section in it, not the sum: one
      // well-visited section does not make the others' records solid.
      confidence: confidenceFrom('stale_pr', Math.min(...filtered.map((o) => o.traversalCount))),
      icon: 'lightning-bolt',
      iconTone: 'opportunity',
      title: t('insights.stalePr.groupTitle', { count: filtered.length }),
      subtitle: subtitleParts.join(', '),
      body:
        filtered
          .slice(0, MAX_STALE_PR_SECTIONS_IN_BODY)
          .map((o) => o.sectionName)
          .join(', ') +
        (filtered.length > MAX_STALE_PR_SECTIONS_IN_BODY
          ? ` (+${filtered.length - MAX_STALE_PR_SECTIONS_IN_BODY} more)`
          : ''),
      navigationTarget: `/section/${filtered[0].sectionId}`,
      timestamp: now,
      isNew: false,
      meta: {
        comparisonKind: 'self',
        // The freshest member, so the group is only as stale as its least stale
        // section. The same for repetitions: one thin member should not let a
        // group through a gate that member would fail alone.
        sourceTimestamp: now - Math.min(...filtered.map((o) => o.daysSinceLast)) * 86_400_000,
        repetitionCount: Math.min(...filtered.map((o) => o.traversalCount)),
      },
      supportingData: {
        sections: filtered.map((o) => ({
          sectionId: o.sectionId,
          sectionName: o.sectionName,
          bestTime: o.bestTimeSecs,
          sportType: o.sportType,
        })),
        formula: subtitleParts.join('; '),
        algorithmDescription: t('insights.stalePr.methodology'),
      },
      methodology: {
        name: t('insights.methodology.fitnessPrName'),
        description: t('insights.stalePr.methodology'),
      },
    },
  ];
}
