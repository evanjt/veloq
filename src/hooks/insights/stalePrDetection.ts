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

export interface StalePRInput {
  sections: StalePRSectionData[];
  ftpTrend: StalePRFtpTrend | null;
  recentPRs: StalePRRecentPR[];
}

export interface StalePROpportunity {
  sectionId: string;
  sectionName: string;
  bestTimeSecs: number;
  currentFtp: number;
  /** Approximate FTP when the PR was set (previous FTP if PR is old enough) */
  estimatedPrFtp: number;
  ftpGainPercent: number;
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

/**
 * Detect sections where a PR might be beatable due to FTP improvement.
 *
 * Heuristic: if FTP increased AND the section hasn't had a PR in the last
 * 30 days, the PR was likely set at a lower FTP. We approximate the FTP
 * at PR time as `previousFtp` when the PR predates the latest FTP change,
 * or `latestFtp` otherwise.
 */
export function detectStalePROpportunities(input: StalePRInput): StalePROpportunity[] {
  const { sections, ftpTrend, recentPRs } = input;

  // No FTP data or no improvement → nothing to flag
  if (!ftpTrend) return [];
  const currentFtp = ftpTrend.latestFtp;
  const previousFtp = ftpTrend.previousFtp;
  if (
    currentFtp == null ||
    previousFtp == null ||
    !Number.isFinite(currentFtp) ||
    !Number.isFinite(previousFtp) ||
    currentFtp <= previousFtp
  ) {
    return [];
  }

  const ftpGainPercent = ((currentFtp - previousFtp) / previousFtp) * 100;
  if (ftpGainPercent < MIN_FTP_GAIN_PERCENT) return [];

  // Build a set of section IDs that had a recent PR (within 30 days)
  const recentPRSectionIds = new Set(
    recentPRs.filter((pr) => pr.daysAgo <= STALE_THRESHOLD_DAYS).map((pr) => pr.sectionId)
  );

  const now = Date.now() / 1000; // current time in seconds

  const opportunities: StalePROpportunity[] = [];

  for (const section of sections) {
    // Skip sections that already had a recent PR
    if (recentPRSectionIds.has(section.sectionId)) continue;

    // Skip sections with no traversals or no valid best time
    if (section.traversalCount === 0 || !Number.isFinite(section.bestTimeSecs)) continue;

    // Check staleness: either via explicit timestamp or by absence from recent PRs
    if (section.lastTraversalTs != null && Number.isFinite(section.lastTraversalTs)) {
      const daysSinceLast = (now - section.lastTraversalTs) / 86400;
      if (daysSinceLast < STALE_THRESHOLD_DAYS) continue;
    }
    // If no timestamp available, rely on the section not being in recentPRs
    // (already filtered above) — conservative: only flag if we can confirm staleness
    // or if the section simply has no recent PR record

    opportunities.push({
      sectionId: section.sectionId,
      sectionName: section.sectionName,
      bestTimeSecs: section.bestTimeSecs,
      currentFtp: currentFtp,
      estimatedPrFtp: previousFtp,
      ftpGainPercent: Math.round(ftpGainPercent * 10) / 10,
    });
  }

  // Sort by FTP gain (all same) then by traversal count (more-visited sections first)
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

  return {
    id: `stale_pr-${opportunity.sectionId}`,
    category: 'stale_pr',
    priority: 2,
    title: t('insights.stalePr.title', { section: opportunity.sectionName }),
    subtitle: t('insights.stalePr.subtitle', {
      prTime,
      prFtp: Math.round(opportunity.estimatedPrFtp),
      currentFtp: Math.round(opportunity.currentFtp),
      gainPercent: opportunity.ftpGainPercent,
    }),
    icon: 'lightning-bolt',
    iconColor: '#FF9800',
    body: t('insights.stalePr.body', {
      section: opportunity.sectionName,
      prTime,
      prFtp: Math.round(opportunity.estimatedPrFtp),
      currentFtp: Math.round(opportunity.currentFtp),
    }),
    navigationTarget: `/section/${opportunity.sectionId}`,
    timestamp,
    isNew: true,
    supportingData: {
      dataPoints: [
        {
          label: t('insights.stalePr.currentFtp'),
          value: `${Math.round(opportunity.currentFtp)}W`,
        },
        {
          label: t('insights.stalePr.prFtp'),
          value: `${Math.round(opportunity.estimatedPrFtp)}W`,
        },
        {
          label: t('insights.stalePr.ftpGain'),
          value: `+${opportunity.ftpGainPercent}%`,
          context: 'good',
        },
        {
          label: t('insights.stalePr.prTime'),
          value: prTime,
        },
      ],
      formula: `FTP gain = (${Math.round(opportunity.currentFtp)} - ${Math.round(opportunity.estimatedPrFtp)}) / ${Math.round(opportunity.estimatedPrFtp)} = +${opportunity.ftpGainPercent}%`,
      algorithmDescription: t('insights.stalePr.methodology'),
    },
    methodology: {
      name: 'FTP-PR cross-reference',
      description: t('insights.stalePr.methodology'),
    },
  };
}
