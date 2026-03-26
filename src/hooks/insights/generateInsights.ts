import type {
  Insight,
  InsightCategory,
  InsightPriority,
  InsightMethodology,
  InsightSupportingData,
} from '@/types';
import { formatDuration } from '@/lib';
import { detectStalePROpportunities, stalePROpportunityToInsight } from './stalePrDetection';
import { generateSectionClusterInsights } from './sectionClusterInsights';
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
}

export interface InsightInputData {
  currentPeriod: PeriodStats | null;
  previousPeriod: PeriodStats | null;
  ftpTrend: FtpTrend | null;
  paceTrend: PaceTrend | null;
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
  // Whether today is a rest day (no activity today)
  isRestDay?: boolean;
  // All section trends (for rest day deep dive)
  allSectionTrends?: SectionTrendData[];
  // Tomorrow's pattern prediction
  tomorrowPattern?: ActivityPattern | null;
  // All detected activity patterns (for weekly heatmap in pattern detail)
  allPatterns?: ActivityPattern[];
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

// TSB zones per intervals.icu convention (informational only, no prescriptive text)
const TSB_ZONES = {
  fresh: { min: 25, color: '#81C784', key: 'fresh' },
  transition: { min: 5, color: '#64B5F6', key: 'transition' },
  greyZone: { min: -10, color: '#9E9E9E', key: 'greyZone' },
  optimal: { min: -30, color: '#66BB6A', key: 'optimal' },
  highRisk: { min: -Infinity, color: '#EF5350', key: 'highRisk' },
} as const;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function generateInsights(data: InsightInputData, t: TFunc): Insight[] {
  const insights: Insight[] = [];
  const now = Date.now();

  // Rest day content — positive framing, never punitive
  if (data.isRestDay) {
    addRestDayInsights(insights, data, now, t);
  }

  // Priority 1: Section PRs
  addSectionPRInsights(insights, data.recentPRs, now, t);

  // Priority 2: TSB Form Position (replaces form advice + form trajectory)
  addTsbFormPositionInsight(insights, data, now, t);

  // Priority 2: HRV Trend (replaces recovery readiness)
  addHrvTrendInsight(insights, data, now, t);

  // Priority 2: Period Comparison
  addPeriodComparisonInsights(insights, data, now, t);

  // Priority 2: FTP/Pace Milestones
  addFitnessMilestoneInsights(insights, data, now, t);

  // Priority 2: Stale PR / Opportunity Detection
  // Cross-references fitness trends against section PRs to find beatable records
  addStalePRInsights(insights, data, now, t);

  // Priority 3: Section Cluster Insights (replaces addSectionTrendInsights)
  // Groups sections by trend direction for aggregate view — one insight per cluster
  addSectionClusterInsights(insights, data, now, t);

  // Priority 1: Aerobic Efficiency Trends
  addEfficiencyTrendInsights(insights, data, now, t);

  insights.sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp);

  return insights;
}

// ---------------------------------------------------------------------------
// Rest Day Content — always positive, never punitive
// ---------------------------------------------------------------------------

function addRestDayInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  // 1. Recent Intensity Context — count high-intensity sessions in trailing 7 days
  const cur = data.currentPeriod;
  const prev = data.previousPeriod;
  if (cur && prev && (cur.totalTss > 0 || prev.totalTss > 0)) {
    // Approximate high-intensity count: sessions with above-average TSS per session
    const totalSessions = cur.count + (prev?.count ?? 0);
    const totalTss = cur.totalTss + (prev?.totalTss ?? 0);
    if (totalSessions > 0 && totalTss > 0) {
      const avgTssPerSession = totalTss / totalSessions;
      // Count sessions in current week with above-average intensity
      // Since we don't have per-session data, estimate from current week's average
      const curAvgTss = cur.count > 0 ? cur.totalTss / cur.count : 0;
      const highIntensityEst =
        curAvgTss > avgTssPerSession * 1.2 ? cur.count : Math.floor(cur.count * 0.4);

      if (cur.count > 0) {
        insights.push(
          makeInsight({
            id: 'rest_day-intensity-context',
            category: 'intensity_context',
            priority: 3,
            icon: 'lightning-bolt',
            iconColor: '#FFA726',
            title: t('insights.restDay.intensityContext', {
              count: cur.count,
              highCount: highIntensityEst,
            }),
            body: t('insights.restDay.intensityContextBody', {
              count: cur.count,
              duration: formatDurationCompact(cur.totalDuration),
            }),
            timestamp: now,
            methodology: {
              name: 'Intensity distribution',
              description:
                'Counts training sessions this week. Athletes naturally distribute about 80% easy and 20% hard sessions.',
            },
          })
        );
      }
    }
  }

  // 2. Section trends on rest day (positive framing)
  const trends = data.allSectionTrends ?? data.sectionTrends;
  if (trends.length > 0) {
    const improvingCount = trends.filter((s) => s.trend === 1).length;

    if (improvingCount > 0) {
      insights.push(
        makeInsight({
          id: 'rest_day-section-trends',
          category: 'section_pr',
          priority: 3,
          icon: 'map-marker-path',
          iconColor: '#66BB6A',
          title: t('insights.restDay.sectionTrends', {
            improving: improvingCount,
            total: trends.length,
          }),
          navigationTarget: '/routes',
          timestamp: now,
          supportingData: {
            sections: trends
              .filter((s) => s.trend === 1)
              .sort((a, b) => (a.daysSinceLast ?? Infinity) - (b.daysSinceLast ?? Infinity))
              .map((s) => ({
                sectionId: s.sectionId,
                sectionName: s.sectionName,
                trend: s.trend,
                traversalCount: s.traversalCount,
                sportType: s.sportType,
                daysSinceLast: s.daysSinceLast,
              })),
          },
        })
      );
    }
  }

  // 3. Pattern prediction for tomorrow — REMOVED from card list.
  // Pattern predictions are shown in the Today banner only.
  // Pattern predictions removed from card list — shown in Today banner only.
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
        iconColor: '#FC4C02',
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
// Priority 2: TSB Form Position (informational — no prescriptive advice)
// Banister EW et al., 1975; Thomas L et al., 2005
// ---------------------------------------------------------------------------

function addTsbFormPositionInsight(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const tsb = data.formTsb;
  const ctl = data.formCtl;
  const atl = data.formAtl;

  if (typeof tsb !== 'number' || !Number.isFinite(tsb)) return;
  if ((!ctl || ctl === 0) && (!atl || atl === 0)) return;

  const zone = resolveTsbZone(tsb);

  insights.push(
    makeInsight({
      id: 'tsb_form-position',
      category: 'tsb_form',
      priority: 2,
      icon: 'heart-pulse',
      iconColor: zone.color,
      title: t(`insights.tsbForm.titles.${zone.key}`, {
        tsb: Math.round(tsb),
      }),
      body: t('insights.tsbForm.body', {
        tsb: Math.round(tsb),
        ctl: Math.round(ctl ?? 0),
        atl: Math.round(atl ?? 0),
        zone: t(`insights.tsbForm.zones.${zone.key}`),
        zoneDescription: t(`insights.tsbForm.zoneDescriptions.${zone.key}`),
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      supportingData: {
        dataPoints: [
          {
            label: 'CTL',
            value: Math.round(ctl ?? 0),
            context: 'neutral',
          },
          {
            label: 'ATL',
            value: Math.round(atl ?? 0),
            context: 'neutral',
          },
          {
            label: 'TSB',
            value: Math.round(tsb),
            context: 'neutral',
          },
        ],
      },
      methodology: {
        name: 'Banister Impulse-Response Model',
        description:
          'Training Stress Balance = CTL - ATL. Based on the Banister impulse-response model with standard 42-day/7-day time constants. These are population defaults — individual time constants vary between athletes.',
        formula: 'TSB = CTL - ATL',
      },
    })
  );
}

function resolveTsbZone(tsb: number): { color: string; key: string } {
  if (tsb > TSB_ZONES.fresh.min) return TSB_ZONES.fresh;
  if (tsb > TSB_ZONES.transition.min) return TSB_ZONES.transition;
  if (tsb > TSB_ZONES.greyZone.min) return TSB_ZONES.greyZone;
  if (tsb > TSB_ZONES.optimal.min) return TSB_ZONES.optimal;
  return TSB_ZONES.highRisk;
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
  const firstAvg = firstHalf.reduce((s, v) => s + v, 0) / firstHalf.length;
  const secondAvg = secondHalf.reduce((s, v) => s + v, 0) / secondHalf.length;

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

  // Suppress all period comparisons when current week has no activities
  if (cur.count === 0) return;

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
        value: useTss ? Math.round(cur.totalTss) : formatDurationCompact(cur.totalDuration),
        unit: useTss ? 'TSS' : undefined,
      },
      previous: {
        label: t('insights.data.lastWeek'),
        value: useTss ? Math.round(prev.totalTss) : formatDurationCompact(prev.totalDuration),
        unit: useTss ? 'TSS' : undefined,
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
        timestamp: now,
        methodology: comparisonMethodology,
        supportingData: comparisonSupportingData,
      })
    );
  }
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
              "Tracks changes in your estimated FTP over time based on power data from your activities. FTP detection uses intervals.icu's algorithms, which may include auto-detection from activity data. Confirm with a structured test before adjusting training zones.",
          },
        })
      );
    }
  }

  // Pace improvement (lower is better — seconds per km)
  const pace = data.paceTrend;
  if (
    pace &&
    typeof pace.latestPace === 'number' &&
    typeof pace.previousPace === 'number' &&
    pace.latestPace > 0 &&
    pace.previousPace > 0 &&
    pace.latestPace < pace.previousPace
  ) {
    const deltaSecs = Math.round(pace.previousPace - pace.latestPace);
    if (deltaSecs > 0) {
      insights.push(
        makeInsight({
          id: 'fitness_milestone-pace',
          category: 'fitness_milestone',
          priority: 2,
          icon: 'run-fast',
          iconColor: '#66BB6A',
          title: t('insights.paceImproved', { delta: deltaSecs }),
          timestamp: now,
          supportingData: {
            dataPoints: [
              {
                label: t('insights.data.currentPace'),
                value: formatDurationCompact(pace.latestPace),
                context: 'good',
              },
              {
                label: t('insights.data.previousPace'),
                value: formatDurationCompact(pace.previousPace),
              },
              {
                label: t('insights.data.improvement'),
                value: deltaSecs,
                unit: 's/km',
                context: 'good',
              },
            ],
          },
          methodology: {
            name: 'Pace trend analysis',
            description:
              'Compares your latest threshold pace estimation against previous values to detect improvement.',
          },
        })
      );
    }
  }
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
    paceTrend: data.paceTrend,
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
    const first = filtered[0];

    // Build sport-aware subtitle: group improvements by metric type
    const powerOpps = filtered.filter((o) => o.fitnessMetric === 'power');
    const paceOpps = filtered.filter((o) => o.fitnessMetric === 'pace');
    const subtitleParts: string[] = [];
    if (powerOpps.length > 0) {
      const p = powerOpps[0];
      subtitleParts.push(`FTP: ${Math.round(p.previousValue)}W → ${Math.round(p.currentValue)}W`);
    }
    if (paceOpps.length > 0) {
      const p = paceOpps[0];
      subtitleParts.push(
        `Pace: ${formatDuration(p.previousValue)} → ${formatDuration(p.currentValue)}`
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
        navigationTarget: `/section/${first.sectionId}`,
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
// Priority 3: Section Cluster Insights
// Groups sections by trend similarity for aggregate observations
// ---------------------------------------------------------------------------

function addSectionClusterInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const trends = data.allSectionTrends ?? data.sectionTrends;
  if (!trends || trends.length === 0) return;

  const clusterInsights = generateSectionClusterInsights(trends, now, t);
  // Show at most 1 cluster insight (the most relevant — improving takes priority)
  if (clusterInsights.length > 0) {
    const insight = clusterInsights[0];

    // Mark sections that have a recent PR so the UI can show a badge on collapsed rows
    const prSectionIds = new Set((data.recentPRs ?? []).map((pr) => pr.sectionId));
    if (prSectionIds.size > 0 && insight.supportingData?.sections) {
      for (const section of insight.supportingData.sections) {
        if (prSectionIds.has(section.sectionId)) {
          section.hasRecentPR = true;
        }
      }
    }

    insights.push(insight);
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
