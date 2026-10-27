import type {
  DataPoint,
  HistorySeries,
  Insight,
  SeriesPoint,
  StalePrSheetSection,
  SupportingSection,
  TFunc,
} from '../types';
import {
  formatDuration,
  formatFullDate,
  formatPaceCompact,
  formatPower,
  formatSwimPace,
  paceUnitLabel,
  swimPaceUnitLabel,
} from '@/shared/format/format';
import type { StalePrOpportunity as EngineStalePrOpportunity } from 'veloqrs';
import type { ActivityType } from '@/types';
import {
  isCyclingActivity,
  isPaceSport,
  isSwimmingActivity,
} from '@/shared/activity/activityUtils';
import { confidenceFrom, INSIGHTS_CONFIG, minAgeDaysFor } from '../lib/config';
import { sectionWithSport } from '../lib/cardSport';
import { markedActivity, sparkline } from '../lib/sparkline';
import { sectionPairKey } from '../lib/sectionIdentity';
import { TIME } from '@/shared/app/time';
import { formatDecimal, formatSignedPercentage } from '@/shared/format';
import { printedValue } from '../lib/printedValue';

/**
 * Stale PR / Opportunity Detection
 *
 * Surfaces sections where the user's PR might be beatable because their
 * fitness has improved since the PR was set. This is pattern recognition,
 * not coaching:
 *
 * 1. eFTP or critical speed rose (fact). Both are estimates read off the
 *    curves, not the FTP or threshold pace setting on the account.
 * 2. Section hasn't been visited recently (fact)
 * 3. PR was set at a lower eFTP or critical speed, read on its own day
 * 4. Therefore, the PR might be beatable (observation, not prescription)
 *
 * Framed as an invitation in the sport's own words: "Ridden 9 times. PR 6:12
 * at Cycling eFTP 238 W, now 252 W". Never an expected or predicted time.
 */

export interface StalePROpportunity {
  sectionId: string;
  sectionName: string;
  bestTimeSecs: number;
  /** 'power' for cycling (eFTP), 'pace' for running and swimming (critical speed) */
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
  /** The efforts on the section, oldest first, the record among them. */
  recentEfforts?: SeriesPoint[];
  bestActivityId?: string;
  /** When the record was set, epoch seconds. `previousValue` is the fitness that day. */
  prDate?: number;
  /** The record effort's mean power in watts, cycling only. */
  prPower?: number;
  /** The record effort's mean speed in m/s, running and swimming only. */
  prSpeed?: number;
  /** The record effort as a percent of that day's fitness. */
  prSharePercent?: number;
  /** The fitness from the first effort to now, with a point on the record's day. */
  fitnessHistory?: SeriesPoint[];
}

// ---------------------------------------------------------------------------
// Insight formatting
// ---------------------------------------------------------------------------

/**
 * The section an opportunity is about, as the sheet reads it for its map, its
 * sport word and its row. One builder for the single card and the group, so a
 * card with one opportunity draws what a group draws for each member.
 */
function supportingSection(opportunity: StalePROpportunity): SupportingSection {
  return {
    sectionId: opportunity.sectionId,
    sectionName: opportunity.sectionName,
    bestTime: opportunity.bestTimeSecs,
    sportType: opportunity.sportType,
  };
}

function opportunityHistory(opportunity: StalePROpportunity, t: TFunc) {
  const activity = opportunity.bestActivityId;
  return sparkline(
    opportunity.recentEfforts,
    t('insights.data.recentEfforts'),
    sectionTarget(opportunity),
    {
      kind: 'timeline',
      mark: markedActivity(opportunity.recentEfforts, activity),
      format: (seconds) => formatDuration(Math.round(seconds)),
    }
  );
}

/**
 * What the compared value is called: eFTP for a ride, critical speed for a
 * run and CSS for a swim. Neither is the threshold setting on the account,
 * so neither label names one.
 */
function metricLabelFor(opportunity: StalePROpportunity, t: TFunc): string {
  if (opportunity.fitnessMetric === 'power') return t('insights.stalePr.metricCyclingEftp');
  if (opportunity.unit === '/100m') return t('insights.stalePr.metricSwimCss');
  return t('insights.stalePr.metricRunningCriticalSpeed');
}

/**
 * The suffix a pace card prints. The engine's `unit` says which sport the
 * value is paced in and stays metric, so the printed suffix comes from the
 * unit preference.
 */
function displayUnit(opportunity: StalePROpportunity, isMetric: boolean): string {
  if (opportunity.fitnessMetric === 'power') return opportunity.unit;
  return opportunity.unit === '/100m' ? swimPaceUnitLabel(isMetric) : paceUnitLabel(isMetric);
}

/** The engine's gain, to the tenth it carries, and whole when it is whole. */
function gainText(percent: number): string {
  return formatSignedPercentage(percent, Number.isInteger(percent) ? 0 : 1);
}

function gainFormula(
  metricLabel: string,
  opportunity: StalePROpportunity,
  digits: number,
  t: TFunc
): string {
  const current = formatDecimal(opportunity.currentValue, digits);
  const previous = formatDecimal(opportunity.previousValue, digits);
  return `${t('insights.stalePr.metricGain', { metric: metricLabel })} = (${current} - ${previous}) / ${previous} = ${gainText(opportunity.gainPercent)}`;
}

/** The fitness as the card prints it: watts, or a pace with its unit. */
function fitnessText(opportunity: StalePROpportunity, value: number, isMetric: boolean): string {
  if (opportunity.fitnessMetric === 'power') return formatPower(value);
  const pace =
    opportunity.unit === '/100m'
      ? formatSwimPace(value, isMetric)
      : formatPaceCompact(value, isMetric);
  return `${pace}${displayUnit(opportunity, isMetric)}`;
}

/**
 * How often the section was done, in the sport's own verb: "Ridden 9 times",
 * "Swum once". A sport with no verb of its own is "done".
 */
function visitedText(opportunity: StalePROpportunity, t: TFunc): string {
  const sport = opportunity.sportType as ActivityType | undefined;
  const count = { count: opportunity.traversalCount };
  if (sport == null) return t('insights.stalePr.visitedOther', count);
  if (isCyclingActivity(sport)) return t('insights.stalePr.visitedRide', count);
  if (sport === 'Walk') return t('insights.stalePr.visitedWalk', count);
  if (sport === 'Hike') return t('insights.stalePr.visitedHike', count);
  if (isSwimmingActivity(sport)) return t('insights.stalePr.visitedSwim', count);
  if (isPaceSport(sport)) return t('insights.stalePr.visitedRun', count);
  return t('insights.stalePr.visitedOther', count);
}

/** The record effort and its share of that day's fitness, or none when either is unknown. */
function effortText(opportunity: StalePROpportunity, t: TFunc, isMetric: boolean) {
  const share = opportunity.prSharePercent;
  if (share == null || !Number.isFinite(share)) return undefined;
  const percent = formatDecimal(share, 0);
  if (opportunity.fitnessMetric === 'power') {
    if (opportunity.prPower == null) return undefined;
    return t('insights.stalePr.sheetEffortPower', {
      power: formatPower(opportunity.prPower),
      share: percent,
    });
  }
  if (opportunity.prSpeed == null) return undefined;
  return t(
    opportunity.unit === '/100m'
      ? 'insights.stalePr.sheetEffortSwim'
      : 'insights.stalePr.sheetEffortRun',
    { pace: fitnessText(opportunity, opportunity.prSpeed, isMetric), share: percent }
  );
}

/** The section's screen, opened on the record's activity when the engine matched one. */
function sectionTarget(opportunity: StalePROpportunity): string {
  const activity = opportunity.bestActivityId;
  return `/section/${opportunity.sectionId}${activity ? `?activityId=${encodeURIComponent(activity)}` : ''}`;
}

/**
 * One section as the sheet draws it while selected: its own record day, its
 * own fitness then and now, its record effort, and one time axis for the
 * fitness line and the efforts, running to now so the gap since the last
 * visit shows.
 */
function sheetSection(
  opportunity: StalePROpportunity,
  t: TFunc,
  nowMs: number,
  isMetric: boolean
): StalePrSheetSection {
  const metric = metricLabelFor(opportunity, t);
  const efforts = opportunity.recentEfforts ?? [];
  const fitness = opportunity.fitnessHistory ?? [];
  const now = Math.floor(nowMs / 1000);
  const prDate = opportunity.prDate ?? efforts[0]?.date ?? now;
  const dates = [prDate, ...efforts.map((p) => p.date), ...fitness.map((p) => p.date)];
  const lastVisit = efforts.at(-1)?.date;
  const fitnessSeries: HistorySeries = {
    label: metric,
    points: fitness,
    format: (value) => fitnessText(opportunity, value, isMetric),
  };
  const effortSeries: HistorySeries = {
    label: t('insights.stalePr.sheetEfforts'),
    points: efforts,
    format: (seconds) => formatDuration(Math.round(seconds)),
  };
  return {
    sectionId: opportunity.sectionId,
    sportType: opportunity.sportType,
    sectionName: opportunity.sectionName,
    name: sectionWithSport(opportunity.sectionName, opportunity.sportType, t),
    visited: visitedText(opportunity, t),
    traversalCount: opportunity.traversalCount,
    summary: t('insights.stalePr.sheetSummary', {
      date: formatFullDate(new Date(prDate * 1000)),
      metric,
      previous: fitnessText(opportunity, opportunity.previousValue, isMetric),
      current: fitnessText(opportunity, opportunity.currentValue, isMetric),
      gain: gainText(opportunity.gainPercent),
    }),
    effort: effortText(opportunity, t, isMetric),
    fitness: fitnessSeries,
    efforts: effortSeries,
    prDate,
    range: { from: Math.min(...dates), to: Math.max(now, ...dates) },
    gap: lastVisit != null && lastVisit < now ? { from: lastVisit, to: now } : undefined,
    gapLabel: t('insights.stalePr.sheetGap', { count: opportunity.daysSinceLast }),
    sectionTarget: sectionTarget(opportunity),
    activityTarget: opportunity.bestActivityId
      ? `/activity/${encodeURIComponent(opportunity.bestActivityId)}`
      : undefined,
  };
}

/** The rules the engine applied, with the thresholds it applied them at. */
function methodologyText(t: TFunc): string {
  return t('insights.stalePr.methodology', {
    visits: INSIGHTS_CONFIG.repetition.stale_pr_min_lifetime,
    days: minAgeDaysFor('stale_pr'),
    gain: INSIGHTS_CONFIG.thresholds.staleMinGainPercent,
    max: INSIGHTS_CONFIG.thresholds.staleMaxOpportunities,
  });
}

/**
 * Convert a StalePROpportunity into an Insight object suitable for the
 * insights panel.
 */
export function stalePROpportunityToInsight(
  opportunity: StalePROpportunity,
  t: TFunc,
  now?: number,
  isMetric = true
): Insight {
  const timestamp = now ?? Date.now();
  const prTime = formatDuration(opportunity.bestTimeSecs);

  const isPower = opportunity.fitnessMetric === 'power';
  const isSwimPace = opportunity.unit === '/100m';
  const metricLabel = metricLabelFor(opportunity, t);
  const currentStr = isPower
    ? formatPower(opportunity.currentValue)
    : isSwimPace
      ? formatSwimPace(opportunity.currentValue, isMetric)
      : formatPaceCompact(opportunity.currentValue, isMetric);
  const previousStr = isPower
    ? formatPower(opportunity.previousValue)
    : isSwimPace
      ? formatSwimPace(opportunity.previousValue, isMetric)
      : formatPaceCompact(opportunity.previousValue, isMetric);
  const unit = displayUnit(opportunity, isMetric);
  const displayedCurrent = isPower ? currentStr : `${currentStr}${unit}`;
  const displayedPrevious = isPower ? previousStr : `${previousStr}${unit}`;
  const current: DataPoint = {
    label: t('insights.stalePr.currentMetric', { metric: metricLabel }),
    value: isPower ? Math.round(opportunity.currentValue) : currentStr,
    unit,
  };
  const gain: DataPoint = {
    label: t('insights.stalePr.metricGain', { metric: metricLabel }),
    value: gainText(opportunity.gainPercent),
    context: 'good',
  };

  return {
    id: `stale_pr-${sectionPairKey(opportunity.sectionId, opportunity.sportType)}`,
    category: 'stale_pr',
    priority: 2,
    // The lifetime traversals are what makes a stale record worth chasing:
    // one that stood over two visits is a weaker claim than one over twenty.
    confidence: confidenceFrom('stale_pr', opportunity.traversalCount),
    title: t('insights.stalePr.title', {
      section: sectionWithSport(opportunity.sectionName, opportunity.sportType, t),
    }),
    subtitle: t('insights.stalePr.subtitle', {
      visited: visitedText(opportunity, t),
      prTime,
      metric: metricLabel,
      previous: displayedPrevious,
      current: displayedCurrent,
    }),
    line: t(
      isPower
        ? 'insights.line.stalePrPower'
        : isSwimPace
          ? 'insights.line.stalePrSwim'
          : 'insights.line.stalePrRun',
      {
        change: printedValue(gain),
        current: printedValue(current),
        name: opportunity.sectionName,
      }
    ),
    icon: 'lightning-bolt',
    iconTone: 'opportunity',
    body: t('insights.stalePr.body', {
      section: sectionWithSport(opportunity.sectionName, opportunity.sportType, t),
      visited: visitedText(opportunity, t),
      metric: metricLabel,
      previous: displayedPrevious,
      current: displayedCurrent,
    }),
    navigationTarget: `/section/${opportunity.sectionId}`,
    timestamp,
    // The dot is the fingerprint diff's to set, so a card the athlete has seen
    // loses it.
    isNew: false,
    meta: {
      comparisonKind: 'self',
      repetitionCount: opportunity.traversalCount,
      // The age of the last traversal, not of the card. The recency gate reads
      // this, and stamping it with `now` would age every card at zero days.
      sourceTimestamp: timestamp - opportunity.daysSinceLast * TIME.DAY,
      placeName: opportunity.sectionName,
      sectionId: opportunity.sectionId,
    },
    supportingData: {
      ...opportunityHistory(opportunity, t),
      sections: [supportingSection(opportunity)],
      stalePrSections: [sheetSection(opportunity, t, timestamp, isMetric)],
      hero: current,
      change: gain,
      dataPoints: [
        current,
        {
          label: t('insights.stalePr.prMetric', { metric: metricLabel }),
          value: isPower ? Math.round(opportunity.previousValue) : previousStr,
          unit,
        },
        gain,
        {
          label: t('insights.stalePr.prTime'),
          value: prTime,
        },
      ],
      // The gain in the unit the engine compared, watts or metres a second.
      formula: gainFormula(metricLabel, opportunity, isPower ? 0 : 2, t),
      algorithmDescription: methodologyText(t),
    },
    methodology: {
      name: t('insights.methodology.stalePrCrossRefName', { metric: metricLabel }),
      description: methodologyText(t),
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
  t: TFunc,
  now: number,
  isMetric = true
): Insight[] {
  // The row is taken whole and only the metric narrowed, so a field the engine
  // adds to the record reaches the card without a copy here to forget it.
  const filtered: StalePROpportunity[] = (opportunities ?? []).map((r) => ({
    ...r,
    fitnessMetric: r.fitnessMetric === 'power' ? 'power' : 'pace',
  }));

  const firstOpportunity = filtered[0];
  if (!firstOpportunity) return [];
  if (filtered.length === 1)
    return [stalePROpportunityToInsight(firstOpportunity, t, now, isMetric)];

  // The group names each metric's value now, once. The value on a record's
  // day is that section's own, so no one section's speaks for the group.
  const subtitleParts: string[] = [];
  const named = new Set<string>();
  for (const o of filtered) {
    const metric = metricLabelFor(o, t);
    if (named.has(metric)) continue;
    named.add(metric);
    subtitleParts.push(
      t('insights.stalePr.groupSubtitle', {
        metric,
        current: fitnessText(o, o.currentValue, isMetric),
      })
    );
  }
  const formula = filtered
    .map(
      (o) =>
        `${sectionWithSport(o.sectionName, o.sportType, t)}: ${gainFormula(metricLabelFor(o, t), o, o.fitnessMetric === 'power' ? 0 : 2, t)}`
    )
    .join('\n');

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
      line: t('insights.line.stalePrGroup', { count: filtered.length }),
      subtitle: subtitleParts.join(', '),
      body:
        filtered
          .slice(0, MAX_STALE_PR_SECTIONS_IN_BODY)
          .map((o) => sectionWithSport(o.sectionName, o.sportType, t))
          .join(', ') +
        (filtered.length > MAX_STALE_PR_SECTIONS_IN_BODY
          ? ` ${t('insights.stalePr.groupMore', { n: filtered.length - MAX_STALE_PR_SECTIONS_IN_BODY })}`
          : ''),
      navigationTarget: `/section/${firstOpportunity.sectionId}`,
      timestamp: now,
      isNew: false,
      meta: {
        comparisonKind: 'self',
        // The freshest member, so the group is only as stale as its least stale
        // section. The same for repetitions: one thin member should not let a
        // group through a gate that member would fail alone.
        sourceTimestamp: now - Math.min(...filtered.map((o) => o.daysSinceLast)) * TIME.DAY,
        repetitionCount: Math.min(...filtered.map((o) => o.traversalCount)),
      },
      supportingData: {
        ...opportunityHistory(firstOpportunity, t),
        sections: filtered.map(supportingSection),
        stalePrSections: filtered.map((o) => sheetSection(o, t, now, isMetric)),
        formula,
        algorithmDescription: methodologyText(t),
      },
      methodology: {
        name: t('insights.methodology.fitnessPrName'),
        description: methodologyText(t),
      },
    },
  ];
}
