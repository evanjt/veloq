import type { Insight, SeriesPoint, SupportingSection, TFunc } from '../types';
import {
  formatDuration,
  formatPaceCompact,
  formatSwimPace,
  paceUnitLabel,
  swimPaceUnitLabel,
} from '@/shared/format/format';
import type { StalePrOpportunity as EngineStalePrOpportunity } from 'veloqrs';
import { confidenceFrom } from '../lib/config';
import { sectionWithSport } from '../lib/cardSport';
import { sparkline } from '../lib/sparkline';
import { sectionPairKey } from '../lib/sectionIdentity';

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
 * Framed as curiosity: "Section X: PR set at Cycling eFTP 155W, now 168W"
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
  /** The last efforts on the section, oldest first, for the card's graphic. */
  recentEfforts?: SeriesPoint[];
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

function gainFormula(
  metricLabel: string,
  opportunity: StalePROpportunity,
  digits: number,
  t: TFunc
): string {
  const current = opportunity.currentValue.toFixed(digits);
  const previous = opportunity.previousValue.toFixed(digits);
  return `${t('insights.stalePr.metricGain', { metric: metricLabel })} = (${current} - ${previous}) / ${previous} = +${opportunity.gainPercent}%`;
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
    ? `${Math.round(opportunity.currentValue)}${opportunity.unit}`
    : isSwimPace
      ? formatSwimPace(opportunity.currentValue, isMetric)
      : formatPaceCompact(opportunity.currentValue, isMetric);
  const previousStr = isPower
    ? `${Math.round(opportunity.previousValue)}${opportunity.unit}`
    : isSwimPace
      ? formatSwimPace(opportunity.previousValue, isMetric)
      : formatPaceCompact(opportunity.previousValue, isMetric);
  const unit = displayUnit(opportunity, isMetric);
  const displayedCurrent = isPower ? currentStr : `${currentStr}${unit}`;
  const displayedPrevious = isPower ? previousStr : `${previousStr}${unit}`;

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
      prTime,
      metric: metricLabel,
      previous: displayedPrevious,
      current: displayedCurrent,
      gainPercent: opportunity.gainPercent,
    }),
    icon: 'lightning-bolt',
    iconTone: 'opportunity',
    body: t('insights.stalePr.body', {
      section: sectionWithSport(opportunity.sectionName, opportunity.sportType, t),
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
      sourceTimestamp: timestamp - opportunity.daysSinceLast * 86_400_000,
      placeName: opportunity.sectionName,
      sectionId: opportunity.sectionId,
    },
    supportingData: {
      ...sparkline(opportunity.recentEfforts, t('insights.data.recentEfforts')),
      sections: [supportingSection(opportunity)],
      dataPoints: [
        {
          label: t('insights.stalePr.currentMetric', { metric: metricLabel }),
          value: isPower ? Math.round(opportunity.currentValue) : currentStr,
          unit,
        },
        {
          label: t('insights.stalePr.prMetric', { metric: metricLabel }),
          value: isPower ? Math.round(opportunity.previousValue) : previousStr,
          unit,
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
      // The gain in the unit the engine compared, watts or metres a second.
      formula: gainFormula(metricLabel, opportunity, isPower ? 0 : 2, t),
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

  if (filtered.length === 0) return [];
  if (filtered.length === 1) return [stalePROpportunityToInsight(filtered[0], t, now, isMetric)];

  const powerOpps = filtered.filter((o) => o.fitnessMetric === 'power');
  const runPaceOpps = filtered.filter((o) => o.fitnessMetric === 'pace' && o.unit === '/km');
  const swimPaceOpps = filtered.filter((o) => o.fitnessMetric === 'pace' && o.unit === '/100m');
  // One move per metric, named the way the single card names it.
  const subtitleParts: string[] = [];
  if (powerOpps.length > 0) {
    const p = powerOpps[0];
    subtitleParts.push(
      `${metricLabelFor(p, t)}: ${Math.round(p.previousValue)}W → ${Math.round(p.currentValue)}W`
    );
  }
  if (runPaceOpps.length > 0) {
    const p = runPaceOpps[0];
    subtitleParts.push(
      `${metricLabelFor(p, t)}: ${formatPaceCompact(p.previousValue, isMetric)}${displayUnit(p, isMetric)} → ${formatPaceCompact(p.currentValue, isMetric)}${displayUnit(p, isMetric)}`
    );
  }
  if (swimPaceOpps.length > 0) {
    const p = swimPaceOpps[0];
    subtitleParts.push(
      `${metricLabelFor(p, t)}: ${formatSwimPace(p.previousValue, isMetric)}${displayUnit(p, isMetric)} → ${formatSwimPace(p.currentValue, isMetric)}${displayUnit(p, isMetric)}`
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
          .map((o) => sectionWithSport(o.sectionName, o.sportType, t))
          .join(', ') +
        (filtered.length > MAX_STALE_PR_SECTIONS_IN_BODY
          ? ` ${t('insights.stalePr.groupMore', { n: filtered.length - MAX_STALE_PR_SECTIONS_IN_BODY })}`
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
        sections: filtered.map(supportingSection),
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
