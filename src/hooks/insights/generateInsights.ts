import type {
  Insight,
  InsightCategory,
  InsightPriority,
  InsightMethodology,
  InsightSupportingData,
} from '@/types';
import { formatDuration, formatPaceCompact, formatSwimPace } from '@/lib';
import { brand } from '@/theme/colors';
import { detectStalePROpportunities, stalePROpportunityToInsight } from './stalePrDetection';
import { generateEfficiencyTrendInsights } from './efficiencyTrendInsights';

/**
 * Insight priority ranking (1 = highest):
 * 1. Section PRs set in last 7 days (Veloq's unique differentiator)
 * 2. TSB form position, HRV trend, period comparison, weekly load change, FTP/pace milestones
 * 3. Section trends, training consistency
 * 4. Activity patterns
 *
 * All insights are INFORMATIONAL only — no prescriptive advice.
 *
 * Insights are generated from cached FFI data — no new queries needed.
 */

// ---------------------------------------------------------------------------
// Input types -- these match what the FFI functions return
// ---------------------------------------------------------------------------

interface PeriodStats {
  count: number;
  totalDuration: number; // seconds
  totalDistance: number; // meters
  totalTss: number;
}

interface FtpTrend {
  latestFtp: number | undefined;
  latestDate: bigint | number | undefined;
  previousFtp: number | undefined;
  previousDate: bigint | number | undefined;
}

interface PaceTrend {
  latestPace: number | undefined;
  latestDate: bigint | number | undefined;
  previousPace: number | undefined;
  previousDate: bigint | number | undefined;
}

interface SectionPR {
  sectionId: string;
  sectionName: string;
  bestTime: number;
  daysAgo: number;
}

interface ActivityPattern {
  sportType: string;
  primaryDay: number; // 0=Mon..6=Sun
  avgDurationSecs: number;
  confidence: number;
  activityCount: number;
}

interface SectionTrendData {
  sectionId: string;
  sectionName: string;
  trend: number; // -1=declining, 0=stable, 1=improving
  medianRecentSecs: number;
  bestTimeSecs: number;
  traversalCount: number;
  sportType?: string; // 'Run', 'Ride', etc.
  daysSinceLast?: number; // days since last traversal
  latestIsPr?: boolean; // whether the most recent effort is the all-time best
}

export interface InsightInputData {
  currentPeriod: PeriodStats | null;
  previousPeriod: PeriodStats | null;
  ftpTrend: FtpTrend | null;
  paceTrend: PaceTrend | null;
  swimPaceTrend?: PaceTrend | null;
  recentPRs: SectionPR[];
  todayPattern: ActivityPattern | null;
  sectionTrends: SectionTrendData[];
  formTsb: number | null;
  formCtl: number | null;
  formAtl: number | null;
  peakCtl: number | null;
  currentCtl: number | null;
  // Wellness trend data (7-day window)
  wellnessWindow?: Array<{
    date: string;
    hrv?: number;
    restingHR?: number;
    sleepSecs?: number;
    ctl?: number;
    atl?: number;
  }>;
  // 4-week chronic period for weekly load change
  chronicPeriod?: PeriodStats | null;
  // Ramp rate from wellness (unused — removed ramp rate insight)
  rampRate?: number | null;
  // All section trends (for cluster/trend insights)
  allSectionTrends?: SectionTrendData[];
  // Section IDs to check for aerobic efficiency trends (from getRankedSections)
  efficiencyTrendSectionIds?: string[];
}

// Translation function type
type TFunc = (key: string, params?: Record<string, string | number>) => string;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PR_INSIGHTS = 3;
const VOLUME_CHANGE_THRESHOLD = 0.1; // 10%

function toSecondsPerDistanceMeters(speedMetersPerSecond: number, distanceMeters: number): number {
  if (!Number.isFinite(speedMetersPerSecond) || speedMetersPerSecond <= 0) return 0;
  return distanceMeters / speedMetersPerSecond;
}

function addPaceMilestoneInsight(
  insights: Insight[],
  pace: PaceTrend | null | undefined,
  now: number,
  t: TFunc,
  options: {
    id: string;
    icon: string;
    iconColor: string;
    paceUnit: string;
    changeUnit: string;
    formatValue: (speedMetersPerSecond: number) => string;
  }
): void {
  if (
    !pace ||
    typeof pace.latestPace !== 'number' ||
    typeof pace.previousPace !== 'number' ||
    pace.latestPace <= 0 ||
    pace.previousPace <= 0 ||
    pace.latestPace <= pace.previousPace
  ) {
    return;
  }

  const distanceMeters = options.paceUnit === '/100m' ? 100 : 1000;
  const currentDisplaySecs = toSecondsPerDistanceMeters(pace.latestPace, distanceMeters);
  const previousDisplaySecs = toSecondsPerDistanceMeters(pace.previousPace, distanceMeters);
  const deltaSecs = Math.round(previousDisplaySecs - currentDisplaySecs);
  const gainPercent = Math.round(((pace.latestPace - pace.previousPace) / pace.previousPace) * 100);

  if (deltaSecs <= 0 || gainPercent <= 0) {
    return;
  }

  insights.push(
    makeInsight({
      id: options.id,
      category: 'fitness_milestone',
      priority: 2,
      icon: options.icon as Insight['icon'],
      iconColor: options.iconColor,
      title: t('insights.paceImproved', {
        delta: `${deltaSecs}${options.changeUnit}`,
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.currentPace'),
            value: options.formatValue(pace.latestPace),
            unit: options.paceUnit,
            context: 'good',
          },
          {
            label: t('insights.data.previousPace'),
            value: options.formatValue(pace.previousPace),
            unit: options.paceUnit,
          },
          {
            label: t('insights.data.improvement'),
            value: `+${gainPercent}%`,
            context: 'good',
          },
        ],
      },
      methodology: {
        name: 'Threshold speed trend analysis',
        description:
          'Compares your latest threshold-speed estimate against previous values, then formats the change as athlete-readable pace for display.',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function generateInsights(data: InsightInputData, t: TFunc): Insight[] {
  const insights: Insight[] = [];
  const now = Date.now();

  // Priority 1: Section PRs
  addSectionPRInsights(insights, data.recentPRs, now, t);

  // Priority 2: HRV Trend (replaces recovery readiness)
  addHrvTrendInsight(insights, data, now, t);

  // Priority 2: Period Comparison
  addPeriodComparisonInsights(insights, data, now, t);

  // Priority 2: FTP/Pace Milestones
  addFitnessMilestoneInsights(insights, data, now, t);

  // Priority 2: Stale PR / Opportunity Detection
  // Cross-references fitness trends against section PRs to find beatable records
  addStalePRInsights(insights, data, now, t);

  // Priority 1: Aerobic Efficiency Trends
  addEfficiencyTrendInsights(insights, data, now, t);

  insights.sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp);

  return insights;
}

// ---------------------------------------------------------------------------
// Priority 1: Section PRs (last 7 days)
// ---------------------------------------------------------------------------

function addSectionPRInsights(
  insights: Insight[],
  recentPRs: SectionPR[],
  now: number,
  t: TFunc
): void {
  if (!recentPRs || recentPRs.length === 0) return;

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
          name: 'Personal record detection',
          description: 'Compares your latest section time against all previous efforts.',
        },
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Priority 2: HRV Trend (replaces Recovery Readiness)
// Kiviniemi et al., 2007 — HRV-guided training RCT
// ---------------------------------------------------------------------------

function addHrvTrendInsight(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const window = data.wellnessWindow ?? [];
  const hrvValues = window.filter((w) => typeof w.hrv === 'number' && w.hrv > 0);

  // Need at least 3 HRV values to compute a trend
  if (hrvValues.length < 3) return;

  const hrvNums = hrvValues.map((w) => w.hrv as number);
  const avg = hrvNums.reduce((s, v) => s + v, 0) / hrvNums.length;
  if (avg <= 0) return;

  // Compute 7-day rolling average direction
  const firstHalf = hrvNums.slice(0, Math.floor(hrvNums.length / 2));
  const secondHalf = hrvNums.slice(Math.floor(hrvNums.length / 2));
  const firstAvg =
    firstHalf.length > 0 ? firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length : 0;
  const secondAvg =
    secondHalf.length > 0 ? secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length : 0;

  // Check for 2 consecutive days of decline (Kiviniemi protocol threshold)
  const lastTwo = hrvNums.slice(-2);
  const consecutiveDecline = lastTwo.length === 2 && lastTwo[0] > lastTwo[1] && lastTwo[1] < avg;

  let trendKey: string;
  let trendColor: string;
  let trendIcon: string;

  if (secondAvg > firstAvg * 1.02) {
    trendKey = 'trendingUp';
    trendColor = '#66BB6A';
    trendIcon = 'trending-up';
  } else if (consecutiveDecline || secondAvg < firstAvg * 0.98) {
    trendKey = 'trendingDown';
    trendColor = '#FFA726';
    trendIcon = 'trending-down';
  } else {
    trendKey = 'stable';
    trendColor = '#42A5F5';
    trendIcon = 'minus';
  }

  const confidence = Math.min(1, hrvValues.length / 7);

  insights.push(
    makeInsight({
      id: 'hrv_trend',
      category: 'hrv_trend',
      priority: 2,
      icon: trendIcon,
      iconColor: trendColor,
      title: t(`insights.hrvTrend.${trendKey}`),
      body: t(`insights.hrvTrend.${trendKey}Body`, {
        avg: Math.round(avg),
        days: hrvValues.length,
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      confidence,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.sevenDayAvg'),
            value: Math.round(avg),
            unit: 'ms',
            context: 'neutral',
          },
          {
            label: t('insights.data.latestHrv'),
            value: Math.round(hrvNums[hrvNums.length - 1]),
            unit: 'ms',
            context: 'neutral',
          },
          {
            label: t('insights.data.dataPoints'),
            value: hrvValues.length,
            unit: t('insights.data.days'),
          },
        ],
        sparklineData: hrvNums,
        sparklineLabel: t('insights.data.hrvSevenDay'),
      },
      methodology: {
        name: 'HRV rolling average trend',
        description:
          'HRV trend based on your 7-day rolling average. HRV accuracy depends on measurement device and consistency. Trends over days are more reliable than single readings.',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 2: Period Comparison (this week vs last — factual)
// ---------------------------------------------------------------------------

function addPeriodComparisonInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const cur = data.currentPeriod;
  const prev = data.previousPeriod;
  if (!cur || !prev) return;

  // When current week has no activities (e.g., Monday morning), fall back to
  // comparing last week against the 4-week chronic average instead of suppressing.
  if (cur.count === 0) {
    addLastWeekVsAverageInsight(insights, prev, data.chronicPeriod ?? null, now, t);
    return;
  }

  // Prefer TSS comparison (accounts for intensity), fall back to duration
  const useTss = prev.totalTss > 0 && cur.totalTss > 0;
  const curValue = useTss ? cur.totalTss : cur.totalDuration;
  const prevValue = useTss ? prev.totalTss : prev.totalDuration;

  if (prevValue <= 0) return;

  const ratio = curValue / prevValue - 1;
  const percent = Math.round(Math.abs(ratio) * 100);

  // Filter out zero-value comparisons (e.g., "100% less" when current is 0)
  if (curValue === 0) return;

  const body = useTss
    ? t('insights.loadBody', {
        currentTss: Math.round(cur.totalTss),
        previousTss: Math.round(prev.totalTss),
        currentDuration: formatDurationCompact(cur.totalDuration),
        previousDuration: formatDurationCompact(prev.totalDuration),
      })
    : t('insights.volumeBody', {
        current: formatDurationCompact(cur.totalDuration),
        previous: formatDurationCompact(prev.totalDuration),
      });

  const upKey = useTss ? 'insights.weeklyLoadUp' : 'insights.weeklyVolumeUp';
  const downKey = useTss ? 'insights.weeklyLoadDown' : 'insights.weeklyVolumeDown';

  const comparisonMethodology: InsightMethodology = {
    name: 'Period comparison',
    description: 'Compares training metrics between consecutive weeks to track progression.',
  };

  const comparisonSupportingData: InsightSupportingData = {
    comparisonData: {
      current: {
        label: t('insights.data.thisWeek'),
        value: useTss ? Math.round(cur.totalTss) : Math.round(cur.totalDuration / 60),
        unit: useTss ? 'TSS' : 'min',
      },
      previous: {
        label: t('insights.data.lastWeek'),
        value: useTss ? Math.round(prev.totalTss) : Math.round(prev.totalDuration / 60),
        unit: useTss ? 'TSS' : 'min',
      },
      change: {
        label: t('insights.data.change'),
        value: `${ratio > 0 ? '+' : ''}${percent}%`,
        context: 'neutral',
      },
    },
    dataPoints: [
      {
        label: t('insights.data.activitiesThisWeek'),
        value: cur.count,
      },
      {
        label: t('insights.data.activitiesLastWeek'),
        value: prev.count,
      },
    ],
  };

  if (ratio > VOLUME_CHANGE_THRESHOLD) {
    insights.push(
      makeInsight({
        id: 'period_comparison-volume',
        category: 'period_comparison',
        priority: 2,
        icon: 'trending-up',
        iconColor: '#66BB6A',
        title: t(upKey, { percent }),
        body,
        navigationTarget: '/routes?tab=routes',
        timestamp: now,
        methodology: comparisonMethodology,
        supportingData: comparisonSupportingData,
      })
    );
  } else if (ratio < -VOLUME_CHANGE_THRESHOLD) {
    insights.push(
      makeInsight({
        id: 'period_comparison-volume',
        category: 'period_comparison',
        priority: 2,
        icon: 'trending-down',
        iconColor: '#FFA726',
        title: t(downKey, { percent }),
        body,
        navigationTarget: '/routes?tab=routes',
        timestamp: now,
        methodology: comparisonMethodology,
        supportingData: comparisonSupportingData,
      })
    );
  }
}

/**
 * Fallback: compare last week against the 4-week chronic average.
 * Used when the current week has no activities yet (e.g., Monday morning).
 * Reuses the existing insights.weeklyLoad.* keys (already in all locales).
 */
function addLastWeekVsAverageInsight(
  insights: Insight[],
  prev: PeriodStats,
  chronic: PeriodStats | null,
  now: number,
  t: TFunc
): void {
  if (prev.count === 0 || !chronic) return;

  const useTss = prev.totalTss > 0 && chronic.totalTss > 0;
  const prevValue = useTss ? prev.totalTss : prev.totalDuration;
  const avgValue = useTss ? chronic.totalTss : chronic.totalDuration;

  if (avgValue <= 0 || prevValue <= 0) return;

  const ratio = prevValue / avgValue - 1;
  const percent = Math.round(Math.abs(ratio) * 100);
  if (percent < 10) return; // Same threshold as normal comparison

  const direction = ratio > 0 ? t('insights.weeklyLoad.above') : t('insights.weeklyLoad.below');

  insights.push(
    makeInsight({
      id: 'period_comparison-volume',
      category: 'period_comparison',
      priority: 2,
      icon: ratio > 0 ? 'trending-up' : 'trending-down',
      iconColor: ratio > 0 ? '#66BB6A' : '#FFA726',
      title: t('insights.weeklyLoad.title', { percent, direction }),
      navigationTarget: '/routes?tab=routes',
      timestamp: now,
      supportingData: {
        comparisonData: {
          current: {
            label: t('insights.data.lastWeek'),
            value: useTss ? Math.round(prev.totalTss) : Math.round(prev.totalDuration / 60),
            unit: useTss ? 'TSS' : 'min',
          },
          previous: {
            label: t('insights.data.fourWeekAvgTss'),
            value: useTss ? Math.round(chronic.totalTss) : Math.round(chronic.totalDuration / 60),
            unit: useTss ? 'TSS' : 'min',
          },
          change: {
            label: t('insights.data.change'),
            value: `${ratio > 0 ? '+' : '-'}${percent}%`,
            context: 'neutral',
          },
        },
      },
      methodology: {
        name: 'Period comparison',
        description:
          'Compares last week against your 4-week average when the current week has no activities yet.',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 2: Fitness milestones (FTP/Pace — direct measurements)
// ---------------------------------------------------------------------------

function addFitnessMilestoneInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  // FTP increase
  const ftp = data.ftpTrend;
  if (
    ftp &&
    typeof ftp.latestFtp === 'number' &&
    typeof ftp.previousFtp === 'number' &&
    ftp.latestFtp > 0 &&
    ftp.previousFtp > 0 &&
    ftp.latestFtp > ftp.previousFtp
  ) {
    const delta = Math.round(ftp.latestFtp - ftp.previousFtp);
    if (delta > 0) {
      insights.push(
        makeInsight({
          id: 'fitness_milestone-ftp',
          category: 'fitness_milestone',
          priority: 2,
          icon: 'lightning-bolt',
          iconColor: '#FFA726',
          title: t('insights.ftpIncrease', {
            current: Math.round(ftp.latestFtp),
            change: delta,
          }),
          navigationTarget: '/fitness',
          timestamp: now,
          supportingData: {
            dataPoints: [
              {
                label: t('insights.data.currentFtp'),
                value: Math.round(ftp.latestFtp),
                unit: 'W',
                context: 'good',
              },
              {
                label: t('insights.data.previousFtp'),
                value: Math.round(ftp.previousFtp),
                unit: 'W',
              },
              {
                label: t('insights.data.change'),
                value: `+${delta}`,
                unit: 'W',
                context: 'good',
              },
            ],
          },
          methodology: {
            name: 'Functional Threshold Power estimation',
            description:
              "Tracks changes in your estimated FTP over time based on power data from your activities. FTP detection uses intervals.icu's algorithms, which may include auto-detection from activity data.",
          },
        })
      );
    }
  }

  addPaceMilestoneInsight(insights, data.paceTrend ?? null, now, t, {
    id: 'fitness_milestone-pace',
    icon: 'run-fast',
    iconColor: '#66BB6A',
    paceUnit: '/km',
    changeUnit: 's/km',
    formatValue: (speedMetersPerSecond) => formatPaceCompact(speedMetersPerSecond),
  });

  addPaceMilestoneInsight(insights, data.swimPaceTrend ?? null, now, t, {
    id: 'fitness_milestone-swim-pace',
    icon: 'swim',
    iconColor: '#42A5F5',
    paceUnit: '/100m',
    changeUnit: 's/100m',
    formatValue: (speedMetersPerSecond) => formatSwimPace(speedMetersPerSecond),
  });
}

// ---------------------------------------------------------------------------
// Priority 2: Stale PR / Opportunity Detection
// Cross-references FTP trend dates against section PR dates
// ---------------------------------------------------------------------------

function addStalePRInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  if ((!data.ftpTrend && !data.paceTrend) || !data.sectionTrends || data.sectionTrends.length === 0)
    return;

  // Build section data with sport type for sport-aware fitness comparison
  const sections = data.sectionTrends.map((s) => ({
    sectionId: s.sectionId,
    sectionName: s.sectionName,
    bestTimeSecs: s.bestTimeSecs,
    traversalCount: s.traversalCount,
    sportType: s.sportType,
  }));

  const opportunities = detectStalePROpportunities({
    sections,
    ftpTrend: data.ftpTrend,
    runPaceTrend: data.paceTrend,
    swimPaceTrend: data.swimPaceTrend ?? null,
    recentPRs: data.recentPRs,
  });

  // Filter out sections that already have a PR insight
  const filtered = opportunities.filter(
    (opp) => !insights.some((i) => i.id === `section_pr-${opp.sectionId}`)
  );

  if (filtered.length === 0) return;

  // Generate ONE grouped card for all beatable PRs instead of individual cards
  if (filtered.length === 1) {
    insights.push(stalePROpportunityToInsight(filtered[0], t, now));
  } else {
    // Group into one card listing all beatable sections
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

    insights.push(
      makeInsight({
        id: 'stale_pr-group',
        category: 'stale_pr',
        priority: 2,
        icon: 'lightning-bolt',
        iconColor: '#FF9800',
        title: t('insights.stalePr.groupTitle', { count: filtered.length }),
        subtitle: subtitleParts.join(', '),
        body: filtered.map((o) => o.sectionName).join(', '),
        navigationTarget: '/routes?tab=sections',
        timestamp: now,
        supportingData: {
          sections: filtered.map((o) => ({
            sectionId: o.sectionId,
            sectionName: o.sectionName,
            bestTime: o.bestTimeSecs,
            sportType: sections.find((s) => s.sectionId === o.sectionId)?.sportType,
          })),
          formula: subtitleParts.join('; '),
          algorithmDescription: t('insights.stalePr.methodology'),
        },
        methodology: {
          name: 'Fitness-PR cross-reference',
          description: t('insights.stalePr.methodology'),
        },
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Priority 1: Aerobic Efficiency Trends
// Coyle et al., 1991; Jones & Carter, 2000
// ---------------------------------------------------------------------------

function addEfficiencyTrendInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const sectionIds = data.efficiencyTrendSectionIds;
  if (!sectionIds || sectionIds.length === 0) return;

  const efficiencyInsights = generateEfficiencyTrendInsights(sectionIds, now, t);
  for (const ei of efficiencyInsights) {
    insights.push(ei);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

interface InsightFields {
  id: string;
  category: InsightCategory;
  priority: InsightPriority;
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
}

function makeInsight(fields: InsightFields): Insight {
  const insight: Insight = { ...fields, isNew: false };
  return insight;
}

/** Format seconds to compact duration string (e.g., "1h30" or "45m"). */
export function formatDurationCompact(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  return `${m}m`;
}
