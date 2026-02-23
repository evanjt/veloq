import type {
  Insight,
  InsightCategory,
  InsightPriority,
  InsightAlternative,
  InsightMethodology,
  InsightSupportingData,
} from '@/types';

/**
 * Insight priority ranking (1 = highest):
 * 1. Section PRs set in last 7 days (Veloq's unique differentiator)
 * 2. Fitness milestones, recovery readiness, ACWR, section performance (FTP increase, pace improvement, peak CTL)
 * 3. Period comparisons, training monotony, form trajectory, ramp rate (this week vs last -- volume, TSS, frequency)
 * 4. Activity patterns (from Rust k-means -- "Tuesdays you usually ride ~1h30")
 * 5. Training consistency + form advice (streak detection, form zones)
 *
 * Academic citations:
 * - Temporal self-comparison enhances intrinsic motivation (Kappen et al., Computers in Human Behavior, 2018)
 * - Goal attainment feedback is the strongest predictor of continued exercise behaviour (Rhodes & Kates, IRSEP, 2015)
 * - Behavioural pattern awareness supports autonomous motivation (Teixeira et al., IJBNPA, 2012)
 * - Medium gamification outperforms high gamification by 19% (Hammedi et al., Frontiers in Psychology, 2025)
 * - Hedonic value more strongly predicts sustained engagement than utility (PMC, 2025)
 * - HRV-guided training readiness (Plews et al., IJSPP, 2013)
 * - Acute:Chronic Workload Ratio for injury prevention (Gabbett, BJSM, 2016)
 * - Training monotony and strain (Foster, Med Sci Sports Exerc, 1998)
 * - Impulse-response model for form projection (Banister et al., 1975)
 * - Ramp rate guidelines (Coggan & Allen, Training and Racing with a Power Meter, 2010)
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
  // 4-week chronic period for ACWR
  chronicPeriod?: PeriodStats | null;
  // Ramp rate from wellness
  rampRate?: number | null;
  // Whether today is a rest day (no activity today)
  isRestDay?: boolean;
  // All section trends (for rest day deep dive)
  allSectionTrends?: SectionTrendData[];
  // Tomorrow's pattern prediction
  tomorrowPattern?: ActivityPattern | null;
}

// Translation function type
type TFunc = (key: string, params?: Record<string, string | number>) => string;

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const MAX_PR_INSIGHTS = 3;
const VOLUME_CHANGE_THRESHOLD = 0.1; // 10%
const PATTERN_CONFIDENCE_THRESHOLD = 0.6;
const CONSISTENCY_MIN_ACTIVITIES = 3;
const CONSISTENCY_MIN_WEEKS = 2;
const PEAK_CTL_PROXIMITY = 0.05; // within 5%

// HRV recovery thresholds
const HRV_DEVIATION_GOOD = 0.05; // >5% above avg
const HRV_DEVIATION_BAD = -0.05; // >5% below avg
const HRV_DEVIATION_CRITICAL = -0.1; // >10% below avg

// ACWR thresholds (Gabbett, 2016)
const ACWR_UNDERTRAINED = 0.8;
const ACWR_SWEET_SPOT_MAX = 1.3;
const ACWR_HIGH_LOAD_MAX = 1.5;

// Training monotony threshold (Foster, 1998)
const MONOTONY_HIGH = 2.0;
const MONOTONY_LOW = 1.5;

// Ramp rate thresholds (Coggan & Allen, 2010)
const RAMP_AGGRESSIVE = 5;
const RAMP_BUILDING_MIN = 3;
const RAMP_MAINTENANCE_MIN = 1;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

const FORM_ZONES = {
  fresh: { min: 15, color: '#66BB6A', key: 'fresh' },
  grey: { min: 5, color: '#9E9E9E', key: 'grey' },
  optimal: { min: -10, color: '#42A5F5', key: 'optimal' },
  tired: { min: -30, color: '#FFA726', key: 'tired' },
  overreaching: { min: -Infinity, color: '#EF5350', key: 'overreaching' },
} as const;

// ---------------------------------------------------------------------------
// Main function
// ---------------------------------------------------------------------------

export function generateInsights(data: InsightInputData, t: TFunc): Insight[] {
  const insights: Insight[] = [];
  const now = Date.now();

  // Rest day content (Phase 5) -- positive framing, never punitive
  if (data.isRestDay) {
    addRestDayInsights(insights, data, now, t);
  }

  // Existing generators (Phase 4: enhanced with alternatives/supportingData/methodology)
  addSectionPRInsights(insights, data.recentPRs, now, t);
  addSectionTrendInsights(insights, data.sectionTrends, now, t);
  addFitnessMilestoneInsights(insights, data, now, t);
  addPeriodComparisonInsights(insights, data, now, t);
  addActivityPatternInsights(insights, data.todayPattern, now, t);
  addConsistencyInsights(insights, data, now, t);
  addFormAdviceInsight(insights, data.formTsb, data.formCtl, data.formAtl, now, t);

  // New generators (Phase 2)
  addRecoveryReadinessInsight(insights, data, now, t);
  addAcwrInsight(insights, data, now, t);
  addTrainingMonotonyInsight(insights, data, now, t);
  addFormTrajectoryInsight(insights, data, now, t);
  addRampRateInsight(insights, data, now, t);
  addSectionPerformanceVsFitnessInsight(insights, data, now, t);

  insights.sort((a, b) => a.priority - b.priority || b.timestamp - a.timestamp);

  return insights;
}

// ---------------------------------------------------------------------------
// Rest Day Content (Phase 5) -- always positive, never punitive
// ---------------------------------------------------------------------------

function addRestDayInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  // 1. Recovery progress (if HRV data available)
  const window = data.wellnessWindow ?? [];
  const hrvValues = window.filter((w) => typeof w.hrv === 'number' && w.hrv > 0);
  if (hrvValues.length >= 2) {
    const firstHalf = hrvValues.slice(0, Math.floor(hrvValues.length / 2));
    const secondHalf = hrvValues.slice(Math.floor(hrvValues.length / 2));
    const firstAvg = firstHalf.reduce((sum, w) => sum + (w.hrv ?? 0), 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, w) => sum + (w.hrv ?? 0), 0) / secondHalf.length;

    if (firstAvg > 0) {
      const changePercent = Math.round(((secondAvg - firstAvg) / firstAvg) * 100);
      if (changePercent > 0) {
        insights.push(
          makeInsight({
            id: 'rest_day-recovery-progress',
            category: 'recovery_readiness',
            priority: 3,
            icon: 'heart-pulse',
            iconColor: '#66BB6A',
            title: t('insights.restDay.recoveryProgress', { percent: changePercent }),
            body: t('insights.restDay.recoveryProgressBody'),
            navigationTarget: '/fitness',
            timestamp: now,
            supportingData: {
              sparklineData: hrvValues.map((w) => w.hrv ?? 0),
              sparklineLabel: t('insights.restDay.hrvTrend'),
            },
          })
        );
      }
    }
  }

  // 2. Section deep dive (if we have section trends)
  const trends = data.allSectionTrends ?? data.sectionTrends;
  if (trends.length > 0) {
    const improvingCount = trends.filter((s) => s.trend === 1).length;
    const decliningCount = trends.filter((s) => s.trend === -1).length;

    insights.push(
      makeInsight({
        id: 'rest_day-section-deep-dive',
        category: 'section_performance',
        priority: 4,
        icon: 'map-marker-path',
        iconColor: '#AB47BC',
        title: t('insights.restDay.sectionDeepDive', { count: trends.length }),
        body: t('insights.restDay.sectionDeepDiveBody', {
          improving: improvingCount,
          declining: decliningCount,
          total: trends.length,
        }),
        navigationTarget: '/routes',
        timestamp: now,
        supportingData: {
          sections: trends.slice(0, 5).map((s) => ({
            sectionId: s.sectionId,
            sectionName: s.sectionName,
            trend: s.trend,
            traversalCount: s.traversalCount,
          })),
        },
      })
    );
  }

  // 3. Pattern prediction for tomorrow
  const tomorrow = data.tomorrowPattern;
  if (tomorrow && tomorrow.confidence >= PATTERN_CONFIDENCE_THRESHOLD) {
    const tomorrowDayIdx = tomorrow.primaryDay;
    const dayName = tomorrowDayIdx >= 0 && tomorrowDayIdx <= 6 ? DAY_NAMES[tomorrowDayIdx] : '';
    const verb = tomorrow.sportType === 'Run' ? 'run' : 'ride';
    const duration = formatDurationCompact(tomorrow.avgDurationSecs);

    insights.push(
      makeInsight({
        id: 'rest_day-tomorrow-pattern',
        category: 'activity_pattern',
        priority: 4,
        icon: 'calendar-arrow-right',
        iconColor: '#AB47BC',
        title: t('insights.restDay.tomorrowPattern', { day: dayName, verb, duration }),
        body: t('insights.restDay.tomorrowPatternBody', {
          sport: tomorrow.sportType,
          count: tomorrow.activityCount,
        }),
        timestamp: now,
        confidence: tomorrow.confidence,
        supportingData: {
          dataPoints: [
            {
              label: t('insights.data.confidence'),
              value: Math.round(tomorrow.confidence * 100),
              unit: '%',
            },
            {
              label: t('insights.data.basedOn'),
              value: tomorrow.activityCount,
              unit: t('insights.data.activities'),
            },
          ],
        },
        methodology: {
          name: 'K-means clustering',
          description:
            'Groups your activities by day, duration, and sport type to identify recurring training patterns.',
          reference: 'Teixeira et al., 2012',
        },
      })
    );
  }
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
          time: formatDurationCompact(pr.bestTime),
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
              value: formatDurationCompact(pr.bestTime),
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
// Priority 2: Section trends (from k-means pattern engine)
// ---------------------------------------------------------------------------

function addSectionTrendInsights(
  insights: Insight[],
  sectionTrends: SectionTrendData[],
  now: number,
  t: TFunc
): void {
  if (!sectionTrends || sectionTrends.length === 0) return;

  const improving = sectionTrends.filter((s) => s.trend === 1);
  const declining = sectionTrends.filter((s) => s.trend === -1);
  const stable = sectionTrends.filter((s) => s.trend === 0);
  const total = sectionTrends.length;

  const allSectionsSupportingData: InsightSupportingData = {
    sections: sectionTrends.slice(0, 10).map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      bestTime: s.bestTimeSecs,
      trend: s.trend,
      traversalCount: s.traversalCount,
    })),
  };

  const trendMethodology: InsightMethodology = {
    name: 'Section trend analysis',
    description: 'Tracks median performance on frequently visited sections over time.',
  };

  // Insight 1: Section trend summary (if we have enough sections with trends)
  if (total >= 3 && improving.length > 0) {
    insights.push(
      makeInsight({
        id: 'section_trend-summary',
        category: 'section_pr',
        priority: 2,
        icon: 'chart-timeline-variant-shimmer',
        iconColor: '#66BB6A',
        title: t('insights.sectionTrendSummary', {
          improving: improving.length,
          total,
        }),
        body: t('insights.sectionTrendSummaryBody', {
          improving: improving.length,
          stable: stable.length,
          declining: declining.length,
          names: improving
            .slice(0, 3)
            .map((s) => s.sectionName)
            .join(', '),
        }),
        navigationTarget: '/routes',
        timestamp: now,
        supportingData: allSectionsSupportingData,
        methodology: trendMethodology,
      })
    );
  }

  // Insight 2: Individual section improving (top 1 only, most traversals first)
  const topImproving = improving.sort((a, b) => b.traversalCount - a.traversalCount).slice(0, 1);

  for (const section of topImproving) {
    // Don't duplicate if we already have a PR insight for this section
    if (insights.some((i) => i.id === `section_pr-${section.sectionId}`)) continue;

    insights.push(
      makeInsight({
        id: `section_trend-improving-${section.sectionId}`,
        category: 'section_pr',
        priority: 2,
        icon: 'trending-up',
        iconColor: '#66BB6A',
        title: t('insights.sectionImproving', { name: section.sectionName }),
        body: t('insights.sectionImprovingBody', {
          name: section.sectionName,
          median: formatDurationCompact(section.medianRecentSecs),
          best: formatDurationCompact(section.bestTimeSecs),
          count: section.traversalCount,
        }),
        navigationTarget: `/section/${section.sectionId}`,
        timestamp: now,
        supportingData: {
          sections: [
            {
              sectionId: section.sectionId,
              sectionName: section.sectionName,
              bestTime: section.bestTimeSecs,
              trend: section.trend,
              traversalCount: section.traversalCount,
            },
          ],
        },
        methodology: trendMethodology,
      })
    );
  }

  // Insight 3: Section declining (gentle nudge for top 1)
  if (declining.length > 0 && improving.length === 0) {
    // Only show declining if nothing is improving (keep it positive)
    const topDeclining = declining.sort((a, b) => b.traversalCount - a.traversalCount)[0];

    insights.push(
      makeInsight({
        id: `section_trend-declining-${topDeclining.sectionId}`,
        category: 'section_pr',
        priority: 4,
        icon: 'trending-down',
        iconColor: '#FFA726',
        title: t('insights.sectionDeclining', { name: topDeclining.sectionName }),
        body: t('insights.sectionDecliningBody', {
          name: topDeclining.sectionName,
          median: formatDurationCompact(topDeclining.medianRecentSecs),
          best: formatDurationCompact(topDeclining.bestTimeSecs),
        }),
        navigationTarget: `/section/${topDeclining.sectionId}`,
        timestamp: now,
        supportingData: {
          sections: [
            {
              sectionId: topDeclining.sectionId,
              sectionName: topDeclining.sectionName,
              bestTime: topDeclining.bestTimeSecs,
              trend: topDeclining.trend,
              traversalCount: topDeclining.traversalCount,
            },
          ],
        },
        methodology: trendMethodology,
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Priority 2: Fitness milestones
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
          title: t('insights.ftpIncrease', { delta }),
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
              'Tracks changes in your estimated FTP over time based on power data from your activities.',
          },
        })
      );
    }
  }

  // Pace improvement (lower is better -- seconds per km)
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

  // Peak CTL (within 5%)
  if (
    typeof data.currentCtl === 'number' &&
    typeof data.peakCtl === 'number' &&
    data.peakCtl > 0 &&
    data.currentCtl > 0 &&
    data.currentCtl >= data.peakCtl * (1 - PEAK_CTL_PROXIMITY)
  ) {
    insights.push(
      makeInsight({
        id: 'fitness_milestone-peak-ctl',
        category: 'fitness_milestone',
        priority: 2,
        icon: 'chart-line',
        iconColor: '#42A5F5',
        title: t('insights.peakFitness', { value: Math.round(data.peakCtl) }),
        timestamp: now,
        supportingData: {
          dataPoints: [
            {
              label: t('insights.data.currentCtl'),
              value: Math.round(data.currentCtl),
              context: 'good',
            },
            {
              label: t('insights.data.peakCtl'),
              value: Math.round(data.peakCtl),
            },
          ],
        },
        methodology: {
          name: 'Chronic Training Load tracking',
          description:
            'Monitors your long-term training load (CTL) and compares it against your all-time peak fitness level.',
        },
      })
    );
  }
}

// ---------------------------------------------------------------------------
// Priority 3: Period comparisons (this week vs last)
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

  // Prefer TSS comparison (accounts for intensity), fall back to duration
  const useTss = prev.totalTss > 0 && cur.totalTss > 0;
  const curValue = useTss ? cur.totalTss : cur.totalDuration;
  const prevValue = useTss ? prev.totalTss : prev.totalDuration;

  if (prevValue <= 0) return;

  const ratio = curValue / prevValue - 1;
  const percent = Math.round(Math.abs(ratio) * 100);

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
        context: Math.abs(ratio) > 0.3 ? 'warning' : 'neutral',
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
        priority: 3,
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
        priority: 3,
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
// Priority 4: Activity patterns
// ---------------------------------------------------------------------------

function addActivityPatternInsights(
  insights: Insight[],
  todayPattern: ActivityPattern | null,
  now: number,
  t: TFunc
): void {
  if (!todayPattern) return;
  if (todayPattern.confidence < PATTERN_CONFIDENCE_THRESHOLD) return;
  if (todayPattern.primaryDay < 0 || todayPattern.primaryDay > 6) return;
  if (!Number.isFinite(todayPattern.avgDurationSecs) || todayPattern.avgDurationSecs <= 0) return;

  const day = DAY_NAMES[todayPattern.primaryDay];
  const verb = todayPattern.sportType === 'Run' ? 'run' : 'ride';
  const duration = formatDurationCompact(todayPattern.avgDurationSecs);

  insights.push(
    makeInsight({
      id: `activity_pattern-${todayPattern.sportType}-${todayPattern.primaryDay}`,
      category: 'activity_pattern',
      priority: 4,
      icon: 'calendar-clock',
      iconColor: '#AB47BC',
      title: t('insights.patternMatch', { day, verb, duration }),
      timestamp: now,
      confidence: todayPattern.confidence,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.confidence'),
            value: Math.round(todayPattern.confidence * 100),
            unit: '%',
          },
          {
            label: t('insights.data.basedOn'),
            value: todayPattern.activityCount,
            unit: t('insights.data.activities'),
          },
          {
            label: t('insights.data.avgDuration'),
            value: duration,
          },
        ],
      },
      methodology: {
        name: 'K-means clustering',
        description:
          'Groups your activities by day, duration, and sport type to identify recurring training patterns.',
        reference: 'Teixeira et al., 2012',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 5: Training consistency
// ---------------------------------------------------------------------------

function addConsistencyInsights(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const cur = data.currentPeriod;
  const prev = data.previousPeriod;
  if (!cur || !prev) return;
  if (cur.count < CONSISTENCY_MIN_ACTIVITIES || prev.count < CONSISTENCY_MIN_ACTIVITIES) {
    return;
  }

  // Both weeks meet the threshold -- count as a 2-week streak at minimum
  const streakWeeks = CONSISTENCY_MIN_WEEKS;
  insights.push(
    makeInsight({
      id: 'training_consistency-streak',
      category: 'training_consistency',
      priority: 5,
      icon: 'fire',
      iconColor: '#FF7043',
      title: t('insights.consistencyStreak', { count: streakWeeks }),
      timestamp: now,
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 5: Form advice (shares priority with consistency)
// ---------------------------------------------------------------------------

function addFormAdviceInsight(
  insights: Insight[],
  formTsb: number | null,
  formCtl: number | null,
  formAtl: number | null,
  now: number,
  t: TFunc
): void {
  if (typeof formTsb !== 'number' || !Number.isFinite(formTsb)) return;
  // Don't generate form insight without actual wellness data
  if ((!formCtl || formCtl === 0) && (!formAtl || formAtl === 0)) return;

  const zone = resolveFormZone(formTsb);

  // Build alternatives for all 5 form zones
  const zoneEntries = Object.entries(FORM_ZONES) as Array<
    [string, { min: number; color: string; key: string }]
  >;
  // Compute max for each zone (the min of the previous zone in order)
  const zoneMaxes: Record<string, number> = {
    fresh: Infinity,
    grey: 15,
    optimal: 5,
    tired: -10,
    overreaching: -30,
  };
  const alternatives: InsightAlternative[] = zoneEntries.map(([, z]) => {
    const isSelected = z.key === zone.key;
    const zMin = z.min === -Infinity ? '<-30' : String(z.min);
    const zMax = zoneMaxes[z.key] === Infinity ? '+' : String(zoneMaxes[z.key]);
    const reasoning = isSelected
      ? t('insights.formAlternatives.selectedReasoning', {
          tsb: Math.round(formTsb),
          zone: t(`insights.formAdvice.${z.key}`),
          min: zMin,
          max: zMax,
        })
      : t('insights.formAlternatives.notSelectedReasoning', {
          tsb: Math.round(formTsb),
          zone: t(`insights.formAdvice.${z.key}`),
          min: zMin,
          max: zMax,
        });

    return {
      key: z.key,
      label: t(`insights.formAdvice.${z.key}`),
      isSelected,
      reasoning,
      thresholds: [
        {
          label: t('insights.data.tsbRange'),
          value: `${zMin} to ${zMax}`,
        },
      ],
    };
  });

  insights.push(
    makeInsight({
      id: 'training_consistency-form',
      category: 'training_consistency',
      priority: 5,
      icon: 'heart-pulse',
      iconColor: zone.color,
      title: t(`insights.formAdvice.${zone.key}`),
      body: t(`insights.formBody.${zone.key}`, {
        tsb: Math.round(formTsb),
        ctl: Math.round(formCtl ?? 0),
        atl: Math.round(formAtl ?? 0),
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      alternatives,
      supportingData: {
        dataPoints: [
          {
            label: 'CTL',
            value: Math.round(formCtl ?? 0),
            context: 'neutral',
          },
          {
            label: 'ATL',
            value: Math.round(formAtl ?? 0),
            context: 'neutral',
          },
          {
            label: 'TSB',
            value: Math.round(formTsb),
            context:
              formTsb > 5
                ? 'good'
                : formTsb > -10
                  ? 'neutral'
                  : formTsb > -30
                    ? 'warning'
                    : 'concern',
          },
        ],
      },
      methodology: {
        name: 'Banister Impulse-Response Model',
        description:
          'Calculates Training Stress Balance from the difference between fitness (CTL) and fatigue (ATL).',
        formula: 'TSB = CTL - ATL',
        reference: 'Banister et al., 1975',
      },
    })
  );
}

function resolveFormZone(tsb: number): { color: string; key: string } {
  if (tsb > FORM_ZONES.fresh.min) return FORM_ZONES.fresh;
  if (tsb > FORM_ZONES.grey.min) return FORM_ZONES.grey;
  if (tsb > FORM_ZONES.optimal.min) return FORM_ZONES.optimal;
  if (tsb > FORM_ZONES.tired.min) return FORM_ZONES.tired;
  return FORM_ZONES.overreaching;
}

// ---------------------------------------------------------------------------
// Priority 2: Recovery Readiness (HRV-guided)
// Plews et al., 2013: HRV trend vs baseline predicts training readiness
// ---------------------------------------------------------------------------

function addRecoveryReadinessInsight(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const window = data.wellnessWindow ?? [];
  const hrvValues = window.filter((w) => typeof w.hrv === 'number' && w.hrv > 0);

  // Need at least 3 HRV values to establish a baseline
  if (hrvValues.length < 3) return;

  const hrvNums = hrvValues.map((w) => w.hrv as number);
  const avg = hrvNums.reduce((s, v) => s + v, 0) / hrvNums.length;
  if (avg <= 0) return;

  const todayHrv = hrvNums[hrvNums.length - 1];
  const deviation = (todayHrv - avg) / avg;
  const tsb = data.formTsb ?? 0;

  // Determine recovery state along 5-point spectrum
  type RecoveryState = {
    key: string;
    icon: string;
    color: string;
    context: 'good' | 'neutral' | 'warning' | 'concern';
  };

  const states: RecoveryState[] = [
    { key: 'wellRecovered', icon: 'battery-charging', color: '#66BB6A', context: 'good' },
    { key: 'adequate', icon: 'battery-medium', color: '#42A5F5', context: 'neutral' },
    { key: 'accumulating', icon: 'battery-low', color: '#FFA726', context: 'warning' },
    { key: 'recoveryNeeded', icon: 'battery-alert', color: '#EF5350', context: 'concern' },
    { key: 'extendedRecovery', icon: 'battery-off', color: '#B71C1C', context: 'concern' },
  ];

  let selectedIdx: number;
  if (deviation > HRV_DEVIATION_GOOD && tsb > 5) {
    selectedIdx = 0; // Well recovered
  } else if (deviation >= HRV_DEVIATION_BAD && tsb > -10) {
    selectedIdx = 1; // Adequately recovered
  } else if (deviation < HRV_DEVIATION_BAD && tsb < -10 && tsb >= -20) {
    selectedIdx = 2; // Accumulating fatigue
  } else if (deviation < HRV_DEVIATION_BAD && tsb < -20 && tsb >= -30) {
    selectedIdx = 3; // Recovery needed
  } else if (deviation < HRV_DEVIATION_CRITICAL && tsb < -30) {
    selectedIdx = 4; // Extended recovery needed
  } else {
    // Default to adequate for ambiguous cases
    selectedIdx = 1;
  }

  const selected = states[selectedIdx];
  const deviationPercent = Math.round(deviation * 100);

  // Build alternatives
  const alternatives: InsightAlternative[] = states.map((state, idx) => ({
    key: state.key,
    label: t(`insights.recovery.${state.key}`),
    isSelected: idx === selectedIdx,
    reasoning:
      idx === selectedIdx
        ? t('insights.recovery.selectedReasoning', {
            deviation: deviationPercent,
            tsb: Math.round(tsb),
          })
        : t('insights.recovery.notSelectedReasoning', {
            deviation: deviationPercent,
            tsb: Math.round(tsb),
            zone: t(`insights.recovery.${state.key}`),
          }),
  }));

  insights.push(
    makeInsight({
      id: 'recovery_readiness',
      category: 'recovery_readiness',
      priority: 2,
      icon: selected.icon,
      iconColor: selected.color,
      title: t(`insights.recovery.${selected.key}`),
      body: t(`insights.recovery.${selected.key}Body`, {
        deviation: Math.abs(deviationPercent),
        direction: deviationPercent >= 0 ? 'above' : 'below',
        tsb: Math.round(tsb),
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      confidence: Math.min(1, hrvValues.length / 7),
      alternatives,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.todayHrv'),
            value: Math.round(todayHrv),
            unit: 'ms',
            context: selected.context,
          },
          {
            label: t('insights.data.sevenDayAvg'),
            value: Math.round(avg),
            unit: 'ms',
          },
          {
            label: 'TSB',
            value: Math.round(tsb),
            context: tsb > 5 ? 'good' : tsb > -10 ? 'neutral' : tsb > -30 ? 'warning' : 'concern',
          },
        ],
        sparklineData: hrvNums,
        sparklineLabel: t('insights.data.hrvSevenDay'),
      },
      methodology: {
        name: 'HRV-guided training',
        description:
          'Compares your heart rate variability trend against your 7-day baseline to assess recovery status and training readiness.',
        formula: 'HRV deviation = (today - 7d avg) / 7d avg x 100',
        reference: 'Plews et al., 2013',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 2: Acute:Chronic Workload Ratio (ACWR)
// Gabbett, 2016: ACWR for training load management and injury prevention
// ---------------------------------------------------------------------------

function addAcwrInsight(insights: Insight[], data: InsightInputData, now: number, t: TFunc): void {
  const acute = data.currentPeriod;
  const chronic = data.chronicPeriod;

  if (!acute || !chronic || chronic.totalTss <= 0) return;

  const acuteLoad = acute.totalTss;
  const chronicLoad = chronic.totalTss; // Already averaged per week in useInsights
  const acwr = acuteLoad / chronicLoad;

  type AcwrZone = {
    key: string;
    color: string;
    context: 'good' | 'warning' | 'concern' | 'neutral';
    min: number;
    max: number;
  };

  const zones: AcwrZone[] = [
    { key: 'undertrained', color: '#42A5F5', context: 'warning', min: 0, max: ACWR_UNDERTRAINED },
    {
      key: 'sweetSpot',
      color: '#66BB6A',
      context: 'good',
      min: ACWR_UNDERTRAINED,
      max: ACWR_SWEET_SPOT_MAX,
    },
    {
      key: 'highLoad',
      color: '#FFA726',
      context: 'warning',
      min: ACWR_SWEET_SPOT_MAX,
      max: ACWR_HIGH_LOAD_MAX,
    },
    {
      key: 'spikeRisk',
      color: '#EF5350',
      context: 'concern',
      min: ACWR_HIGH_LOAD_MAX,
      max: Infinity,
    },
  ];

  let selectedIdx: number;
  if (acwr < ACWR_UNDERTRAINED) {
    selectedIdx = 0;
  } else if (acwr <= ACWR_SWEET_SPOT_MAX) {
    selectedIdx = 1;
  } else if (acwr <= ACWR_HIGH_LOAD_MAX) {
    selectedIdx = 2;
  } else {
    selectedIdx = 3;
  }

  const selected = zones[selectedIdx];

  const alternatives: InsightAlternative[] = zones.map((zone, idx) => ({
    key: zone.key,
    label: t(`insights.acwr.${zone.key}`),
    isSelected: idx === selectedIdx,
    reasoning:
      idx === selectedIdx
        ? t('insights.acwr.selectedReasoning', {
            acwr: acwr.toFixed(2),
            zone: t(`insights.acwr.${zone.key}`),
            min: zone.min.toFixed(1),
            max: zone.max === Infinity ? '+' : zone.max.toFixed(1),
          })
        : t('insights.acwr.notSelectedReasoning', {
            acwr: acwr.toFixed(2),
            zone: t(`insights.acwr.${zone.key}`),
            min: zone.min.toFixed(1),
            max: zone.max === Infinity ? '+' : zone.max.toFixed(1),
          }),
    thresholds: [
      {
        label: t('insights.data.acwrRange'),
        value: `${zone.min.toFixed(1)}-${zone.max === Infinity ? '+' : zone.max.toFixed(1)}`,
      },
    ],
  }));

  insights.push(
    makeInsight({
      id: 'workload_risk-acwr',
      category: 'workload_risk',
      priority: 2,
      icon: acwr > ACWR_SWEET_SPOT_MAX ? 'alert-circle-outline' : 'shield-check-outline',
      iconColor: selected.color,
      title: t(`insights.acwr.${selected.key}`),
      body: t(`insights.acwr.${selected.key}Body`, {
        acwr: acwr.toFixed(2),
        acute: Math.round(acuteLoad),
        chronic: Math.round(chronicLoad),
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      alternatives,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.acuteTss'),
            value: Math.round(acuteLoad),
            unit: 'TSS',
          },
          {
            label: t('insights.data.chronicAvgTss'),
            value: Math.round(chronicLoad),
            unit: 'TSS',
          },
          {
            label: 'ACWR',
            value: acwr.toFixed(2),
            context: selected.context,
            range: { min: ACWR_UNDERTRAINED, max: ACWR_HIGH_LOAD_MAX, label: 'Sweet spot' },
          },
        ],
      },
      methodology: {
        name: 'Acute:Chronic Workload Ratio',
        description:
          "Compares this week's training stress against your 4-week average to assess injury risk and training progression.",
        formula: 'ACWR = acute load / chronic load',
        reference: 'Gabbett, 2016',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 3: Training Monotony
// Foster, 1998: Training monotony and strain as predictors of overtraining
// ---------------------------------------------------------------------------

function addTrainingMonotonyInsight(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const window = data.wellnessWindow ?? [];

  // Approximate daily load from CTL/ATL differences or use raw values
  const dailyLoads: number[] = [];
  for (const day of window) {
    // Use ATL as daily load proxy (ATL reacts faster to daily training)
    const load = day.atl ?? day.ctl ?? 0;
    if (load > 0) dailyLoads.push(load);
  }

  // Need at least 3 days with data to compute meaningful statistics
  if (dailyLoads.length < 3) return;

  const mean = dailyLoads.reduce((s, v) => s + v, 0) / dailyLoads.length;
  if (mean <= 0) return;

  const variance = dailyLoads.reduce((s, v) => s + (v - mean) ** 2, 0) / dailyLoads.length;
  const stddev = Math.sqrt(variance);

  if (stddev <= 0) return;

  const monotony = mean / stddev;

  let key: string;
  let color: string;
  let context: 'good' | 'warning' | 'neutral';

  if (monotony > MONOTONY_HIGH) {
    key = 'highMonotony';
    color = '#FFA726';
    context = 'warning';
  } else if (monotony < MONOTONY_LOW) {
    key = 'goodVariety';
    color = '#66BB6A';
    context = 'good';
  } else {
    key = 'moderate';
    color = '#42A5F5';
    context = 'neutral';
  }

  insights.push(
    makeInsight({
      id: 'workload_risk-monotony',
      category: 'workload_risk',
      priority: 3,
      icon: monotony > MONOTONY_HIGH ? 'repeat' : 'shuffle-variant',
      iconColor: color,
      title: t(`insights.monotony.${key}`),
      body: t(`insights.monotony.${key}Body`, { value: monotony.toFixed(1) }),
      navigationTarget: '/fitness',
      timestamp: now,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.monotony'),
            value: monotony.toFixed(1),
            context,
            range: { min: MONOTONY_LOW, max: MONOTONY_HIGH },
          },
          {
            label: t('insights.data.meanLoad'),
            value: Math.round(mean),
          },
          {
            label: t('insights.data.loadVariation'),
            value: Math.round(stddev),
          },
        ],
      },
      methodology: {
        name: 'Training Monotony',
        description:
          'Measures how repetitive your training load is across the week. High monotony increases risk of overtraining.',
        formula: 'Monotony = mean(daily load) / SD(daily load)',
        reference: 'Foster, 1998',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 3: Form Trajectory
// Banister et al., 1975: ATL decays ~2x faster than CTL
// ---------------------------------------------------------------------------

function addFormTrajectoryInsight(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const ctl = data.formCtl;
  const atl = data.formAtl;
  const tsb = data.formTsb;

  if (typeof ctl !== 'number' || typeof atl !== 'number' || typeof tsb !== 'number') return;
  if (!Number.isFinite(ctl) || !Number.isFinite(atl) || !Number.isFinite(tsb)) return;
  if (ctl === 0 && atl === 0) return;

  // Project TSB trend: ATL decays with ~7-day time constant, CTL with ~42-day
  // If ATL > CTL, TSB is negative but improving as ATL decays faster
  // Approximate daily TSB change: ATL decays by ~14% per day, CTL by ~2.4%
  const atlDecayRate = 1 / 7; // ~14% daily
  const ctlDecayRate = 1 / 42; // ~2.4% daily
  const projectedAtlChange = -atl * atlDecayRate;
  const projectedCtlChange = -ctl * ctlDecayRate;
  const tsbTrend = -(projectedAtlChange - projectedCtlChange); // TSB = CTL - ATL, so dTSB = dCTL - dATL

  let key: string;
  let color: string;
  let icon: string;

  if (tsbTrend > 0.5) {
    key = 'improving';
    color = '#66BB6A';
    icon = 'arrow-up-bold-circle-outline';

    // Estimate days to reach positive TSB (if currently negative)
    if (tsb < 0) {
      const daysToPositive = Math.ceil(Math.abs(tsb) / tsbTrend);
      if (daysToPositive <= 14) {
        key = 'improvingWithEstimate';
      }
    }
  } else if (tsbTrend < -0.5) {
    key = 'declining';
    color = '#FFA726';
    icon = 'arrow-down-bold-circle-outline';
  } else {
    key = 'stable';
    color = '#42A5F5';
    icon = 'minus-circle-outline';
  }

  // Build sparkline from wellness window if available
  const sparklineData: number[] = [];
  const window = data.wellnessWindow ?? [];
  for (const day of window) {
    const dayCtl = day.ctl ?? 0;
    const dayAtl = day.atl ?? 0;
    if (dayCtl > 0 || dayAtl > 0) {
      sparklineData.push(dayCtl - dayAtl);
    }
  }

  const bodyParams: Record<string, string | number> = {
    tsb: Math.round(tsb),
    ctl: Math.round(ctl),
    atl: Math.round(atl),
  };

  if (key === 'improvingWithEstimate' && tsb < 0 && tsbTrend > 0) {
    const daysToPositive = Math.ceil(Math.abs(tsb) / tsbTrend);
    bodyParams.days = daysToPositive;
  }

  insights.push(
    makeInsight({
      id: 'form_trajectory',
      category: 'form_trajectory',
      priority: 3,
      icon,
      iconColor: color,
      title: t(`insights.formTrajectory.${key}`),
      body: t(`insights.formTrajectory.${key}Body`, bodyParams),
      navigationTarget: '/fitness',
      timestamp: now,
      supportingData: {
        dataPoints: [
          { label: 'CTL', value: Math.round(ctl) },
          { label: 'ATL', value: Math.round(atl) },
          {
            label: 'TSB',
            value: Math.round(tsb),
            context: tsb > 5 ? 'good' : tsb > -10 ? 'neutral' : tsb > -30 ? 'warning' : 'concern',
          },
          {
            label: t('insights.data.dailyTrend'),
            value: `${tsbTrend > 0 ? '+' : ''}${tsbTrend.toFixed(1)}`,
            context: tsbTrend > 0 ? 'good' : tsbTrend < 0 ? 'warning' : 'neutral',
          },
        ],
        sparklineData: sparklineData.length >= 2 ? sparklineData : undefined,
        sparklineLabel: sparklineData.length >= 2 ? 'TSB' : undefined,
      },
      methodology: {
        name: 'Form projection',
        description:
          'Projects your Training Stress Balance forward based on current fitness and fatigue trends.',
        formula: 'TSB = CTL - ATL (ATL decays ~2x faster than CTL)',
        reference: 'Banister et al., 1975',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 3: Ramp Rate
// Coggan & Allen, 2010: CTL ramp rate guidelines
// ---------------------------------------------------------------------------

function addRampRateInsight(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const rampRate = data.rampRate;
  const ctl = data.formCtl;

  if (typeof rampRate !== 'number' || !Number.isFinite(rampRate)) return;

  type RampZone = {
    key: string;
    color: string;
    context: 'good' | 'warning' | 'concern' | 'neutral';
    min: number;
    max: number;
  };

  const zones: RampZone[] = [
    {
      key: 'detraining',
      color: '#42A5F5',
      context: 'warning',
      min: -Infinity,
      max: RAMP_MAINTENANCE_MIN,
    },
    {
      key: 'maintenance',
      color: '#9E9E9E',
      context: 'neutral',
      min: RAMP_MAINTENANCE_MIN,
      max: RAMP_BUILDING_MIN,
    },
    {
      key: 'building',
      color: '#66BB6A',
      context: 'good',
      min: RAMP_BUILDING_MIN,
      max: RAMP_AGGRESSIVE,
    },
    {
      key: 'aggressive',
      color: '#EF5350',
      context: 'concern',
      min: RAMP_AGGRESSIVE,
      max: Infinity,
    },
  ];

  let selectedIdx: number;
  if (rampRate < RAMP_MAINTENANCE_MIN) {
    selectedIdx = 0;
  } else if (rampRate < RAMP_BUILDING_MIN) {
    selectedIdx = 1;
  } else if (rampRate < RAMP_AGGRESSIVE) {
    selectedIdx = 2;
  } else {
    selectedIdx = 3;
  }

  const selected = zones[selectedIdx];

  const alternatives: InsightAlternative[] = zones.map((zone, idx) => ({
    key: zone.key,
    label: t(`insights.rampRate.${zone.key}`),
    isSelected: idx === selectedIdx,
    reasoning:
      idx === selectedIdx
        ? t('insights.rampRate.selectedReasoning', {
            rate: rampRate.toFixed(1),
            zone: t(`insights.rampRate.${zone.key}`),
            min: zone.min === -Infinity ? '-' : zone.min.toFixed(0),
            max: zone.max === Infinity ? '+' : zone.max.toFixed(0),
          })
        : t('insights.rampRate.notSelectedReasoning', {
            rate: rampRate.toFixed(1),
            zone: t(`insights.rampRate.${zone.key}`),
            min: zone.min === -Infinity ? '-' : zone.min.toFixed(0),
            max: zone.max === Infinity ? '+' : zone.max.toFixed(0),
          }),
    thresholds: [
      {
        label: t('insights.data.rampRange'),
        value: `${zone.min === -Infinity ? '<' : zone.min.toFixed(0)}-${zone.max === Infinity ? '+' : zone.max.toFixed(0)}`,
        unit: 'CTL/wk',
      },
    ],
  }));

  insights.push(
    makeInsight({
      id: 'form_trajectory-ramp',
      category: 'form_trajectory',
      priority: 3,
      icon:
        rampRate >= RAMP_AGGRESSIVE
          ? 'rocket-launch-outline'
          : rampRate >= RAMP_BUILDING_MIN
            ? 'trending-up'
            : rampRate >= RAMP_MAINTENANCE_MIN
              ? 'minus'
              : 'trending-down',
      iconColor: selected.color,
      title: t(`insights.rampRate.${selected.key}`),
      body: t(`insights.rampRate.${selected.key}Body`, {
        rate: rampRate.toFixed(1),
        ctl: Math.round(ctl ?? 0),
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      alternatives,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.rampRate'),
            value: rampRate.toFixed(1),
            unit: 'CTL/wk',
            context: selected.context,
            range: { min: RAMP_MAINTENANCE_MIN, max: RAMP_AGGRESSIVE },
          },
          ...(typeof ctl === 'number' && ctl > 0
            ? [
                {
                  label: 'CTL',
                  value: Math.round(ctl),
                },
              ]
            : []),
        ],
      },
      methodology: {
        name: 'Ramp Rate',
        description: 'Measures how quickly your fitness (CTL) is changing per week.',
        formula: 'Ramp Rate = CTL change per week',
        reference: 'Coggan & Allen, 2010',
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 2: Section Performance vs Fitness
// ---------------------------------------------------------------------------

function addSectionPerformanceVsFitnessInsight(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const ctl = data.formCtl;
  if (typeof ctl !== 'number' || ctl <= 0) return;

  const trends = data.sectionTrends;
  if (!trends || trends.length === 0) return;

  const improving = trends.filter((s) => s.trend === 1);
  if (improving.length === 0) return;

  // Pick the top improving section by traversal count
  const topSection = improving.sort((a, b) => b.traversalCount - a.traversalCount)[0];

  insights.push(
    makeInsight({
      id: `section_performance-fitness-${topSection.sectionId}`,
      category: 'section_performance',
      priority: 2,
      icon: 'chart-areaspline',
      iconColor: '#66BB6A',
      title: t('insights.sectionPerformance.fitnessGains', { name: topSection.sectionName }),
      body: t('insights.sectionPerformance.fitnessGainsBody', {
        name: topSection.sectionName,
        ctl: Math.round(ctl),
        best: formatDurationCompact(topSection.bestTimeSecs),
      }),
      navigationTarget: `/section/${topSection.sectionId}`,
      timestamp: now,
      supportingData: {
        sections: improving.slice(0, 3).map((s) => ({
          sectionId: s.sectionId,
          sectionName: s.sectionName,
          bestTime: s.bestTimeSecs,
          trend: s.trend,
          traversalCount: s.traversalCount,
        })),
        dataPoints: [
          {
            label: 'CTL',
            value: Math.round(ctl),
            context: 'good',
          },
          {
            label: t('insights.data.improvingSections'),
            value: improving.length,
            context: 'good',
          },
        ],
      },
      methodology: {
        name: 'Section performance correlation',
        description:
          'Identifies sections where your performance is improving alongside rising fitness (CTL), suggesting your training is translating to real-world gains.',
      },
    })
  );
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
  alternatives?: InsightAlternative[];
  supportingData?: InsightSupportingData;
  methodology?: InsightMethodology;
  confidence?: number;
}

function makeInsight(fields: InsightFields): Insight {
  const insight: Insight = { ...fields, isNew: true };
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
