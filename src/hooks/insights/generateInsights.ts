import type {
  Insight,
  InsightCategory,
  InsightPriority,
  InsightMethodology,
  InsightReference,
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
 * Evidence base:
 * Banister EW et al., Aust J Sports Med, 1975 — Impulse-response model (TSB)
 * Thomas L et al., J Sports Sci, 2005 — Model validation (R²=0.79, time constant variance)
 * Kiviniemi AM et al., Eur J Appl Physiol, 2007 — HRV-guided training RCT (VO2max +4)
 * Schneider C et al., J Sci Med Sport, 2021 — HRV wearables meta-analysis (g=0.296)
 * Bellenger CR et al., Int J Environ Res Public Health, 2021 — HRV meta-analysis (SMD=0.50)
 * Plews DJ et al., Int J Sports Physiol Perform, 2013 — HRV rolling average methodology
 * Impellizzeri FM et al., Int J Sports Physiol Perform, 2020 — ACWR critique (acute load sufficient)
 * Seiler S & Kjerland GO, Scand J Med Sci Sports, 2006 — Intensity distribution
 * Stoggl T & Sperlich B, Front Physiol, 2014 — Polarized training RCT
 * Lally P et al., Eur J Soc Psychol, 2010 — Habit formation (median 66 days)
 * Kaushal N & Rhodes RE, J Behav Med, 2015 — Exercise habit (4x/week, 6 weeks)
 * Silverman J & Barasch A, J Consumer Res, 2023 — Broken streak demotivation
 * Michie S et al., Health Psychol, 2009 — Self-monitoring meta-regression
 * Chevance G et al., Sports Med Open, 2024 — Behavioural perspective on exercise adherence
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
const PATTERN_CONFIDENCE_THRESHOLD = 0.6;
const CONSISTENCY_MIN_ACTIVITIES = 3;

const DAY_NAMES = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'] as const;

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

  // Note: addSectionTrendInsights REMOVED — replaced by addSectionClusterInsights (no duplicates)
  // Note: addConsistencyInsights REMOVED — "Trained X of Y weeks" was a guilt trip
  // Note: addActivityPatternInsights REMOVED — pattern predictions shown in Today banner only

  // Priority 2: Stale PR / Opportunity Detection
  // Cross-references fitness trends against section PRs to find beatable records
  addStalePRInsights(insights, data, now, t);

  // Priority 3: Section Cluster Insights (replaces addSectionTrendInsights)
  // Groups sections by trend direction for aggregate view — one insight per cluster
  addSectionClusterInsights(insights, data, now, t);

  // Priority 1: Aerobic Efficiency Trends
  // Detects improving HR/pace ratio on top sections (Coyle et al., 1991)
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
              references: [
                {
                  citation:
                    'Seiler, S., & Kjerland, G. O. (2006). Quantifying training intensity distribution in elite endurance athletes. Scandinavian Journal of Medicine & Science in Sports, 16(1), 49–56.',
                  url: 'https://pubmed.ncbi.nlm.nih.gov/16430681/',
                },
                {
                  citation:
                    'Stöggl, T., & Sperlich, B. (2014). Polarized training has greater impact on key endurance variables than threshold, high intensity, or high volume training. Frontiers in Physiology, 5, 33.',
                  url: 'https://pubmed.ncbi.nlm.nih.gov/24570662/',
                },
              ],
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
              .map((s) => ({
                sectionId: s.sectionId,
                sectionName: s.sectionName,
                trend: s.trend,
                traversalCount: s.traversalCount,
                sportType: s.sportType,
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
          'Training Stress Balance = CTL - ATL. Based on the Banister impulse-response model with standard 42-day/7-day time constants. These are population defaults — individual time constants vary (Thomas et al. 2005 found SD of ±16 days for the fitness constant).',
        formula: 'TSB = CTL - ATL',
        references: [
          {
            citation:
              'Banister, E. W., Calvert, T. W., Savage, M. V., & Bach, T. (1975). A systems model of training for athletic performance. Australian Journal of Sports Medicine, 7, 57–61.',
            url: 'https://doi.org/10.4324/9781003360858-36',
          },
          {
            citation:
              'Thomas, L., Mujika, I., & Busso, T. (2005). Computer simulations assessing the potential performance benefit of a final increase in training during pre-event taper. Journal of Sports Sciences, 23(10), 1101–1109.',
            url: 'https://pubmed.ncbi.nlm.nih.gov/16194984/',
          },
        ],
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
// Kiviniemi et al., 2007; Schneider et al., 2021; Plews et al., 2013
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
          'HRV trend based on your 7-day rolling average. HRV accuracy depends on measurement device and consistency. Wrist-based readings have higher day-to-day noise than chest straps (Plews et al. 2013). Trends over days are more reliable than single readings.',
        references: [
          {
            citation:
              'Kiviniemi, A. M., Hautala, A. J., Kinnunen, H., & Tulppo, M. P. (2007). Endurance training guided by daily heart rate variability measurements. European Journal of Applied Physiology, 101(6), 743–751.',
            url: 'https://pubmed.ncbi.nlm.nih.gov/17849143/',
          },
          {
            citation:
              'Schneider, C., Hanakam, F., Wiewelhove, T., Döweling, A., Kellmann, M., Meyer, T., Pfeiffer, M., & Ferrauti, A. (2018). Heart rate monitoring in team sports — A conceptual framework for contextual analyses. International Journal of Sports Physiology and Performance, 13(6), 1–9.',
            url: 'https://pubmed.ncbi.nlm.nih.gov/34140252/',
          },
          {
            citation:
              'Plews, D. J., Laursen, P. B., Kilding, A. E., & Buchheit, M. (2013). Heart rate variability in elite triathletes: Is variation in variability the key to effective training? International Journal of Sports Physiology and Performance, 8(6), 611–618.',
            url: 'https://pubmed.ncbi.nlm.nih.gov/23852425/',
          },
        ],
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
// Priority 2: Weekly Load Change (replaces ACWR)
// Impellizzeri FM et al., 2020: acute load alone has equivalent predictive
// power to the ACWR ratio. The ratio confers no additional value.
// ---------------------------------------------------------------------------

function addWeeklyLoadChangeInsight(
  insights: Insight[],
  data: InsightInputData,
  now: number,
  t: TFunc
): void {
  const acute = data.currentPeriod;
  const chronic = data.chronicPeriod;

  if (!acute || !chronic || chronic.totalTss <= 0) return;

  // Suppress when current week has no activities (avoids "100% below average")
  if (acute.count === 0) return;

  // Skip when period comparison already covers weekly volume change
  if (insights.some((i) => i.id === 'period_comparison-volume')) return;

  const acuteLoad = acute.totalTss;
  const chronicAvg = chronic.totalTss; // Already averaged per week in useInsights
  const percentChange = Math.round(((acuteLoad - chronicAvg) / chronicAvg) * 100);

  // Only show if there's a meaningful difference (>15%)
  if (Math.abs(percentChange) < 15) return;

  const isAbove = percentChange > 0;

  insights.push(
    makeInsight({
      id: 'weekly_load-change',
      category: 'weekly_load',
      priority: 2,
      icon: isAbove ? 'trending-up' : 'trending-down',
      iconColor: isAbove ? '#FFA726' : '#42A5F5',
      title: t('insights.weeklyLoad.title', {
        percent: Math.abs(percentChange),
        direction: isAbove ? t('insights.weeklyLoad.above') : t('insights.weeklyLoad.below'),
      }),
      body: t('insights.weeklyLoad.body', {
        acute: Math.round(acuteLoad),
        chronic: Math.round(chronicAvg),
        percent: Math.abs(percentChange),
      }),
      navigationTarget: '/fitness',
      timestamp: now,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.thisWeekTss'),
            value: Math.round(acuteLoad),
            unit: 'TSS',
          },
          {
            label: t('insights.data.fourWeekAvgTss'),
            value: Math.round(chronicAvg),
            unit: 'TSS',
          },
          {
            label: t('insights.data.change'),
            value: `${isAbove ? '+' : ''}${percentChange}%`,
            context: 'neutral',
          },
        ],
      },
      methodology: {
        name: 'Weekly load comparison',
        description:
          "Compares this week's training load against your 4-week average. Impellizzeri et al. (2020) demonstrated that monitoring acute load alone has equivalent predictive power to the ACWR ratio.",
        references: [
          {
            citation:
              'Impellizzeri, F. M., Woodcock, S., Coutts, A. J., Fanchini, M., McCall, A., & Ward, P. (2020). Acute:chronic workload ratio: Conceptual issues and fundamental pitfalls. International Journal of Sports Physiology and Performance, 15(6), 907–913.',
            url: 'https://pubmed.ncbi.nlm.nih.gov/32502973/',
          },
        ],
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
// Priority 3: Section trends (from k-means pattern engine)
// ---------------------------------------------------------------------------

function addSectionTrendInsights(
  insights: Insight[],
  sectionTrends: SectionTrendData[],
  now: number,
  t: TFunc
): void {
  if (!sectionTrends || sectionTrends.length === 0) return;

  const improving = sectionTrends.filter((s) => s.trend === 1);
  const stable = sectionTrends.filter((s) => s.trend === 0);
  const total = sectionTrends.length;

  const allSectionsSupportingData: InsightSupportingData = {
    sections: sectionTrends.map((s) => ({
      sectionId: s.sectionId,
      sectionName: s.sectionName,
      bestTime: s.bestTimeSecs,
      trend: s.trend,
      traversalCount: s.traversalCount,
      sportType: s.sportType,
    })),
  };

  const trendMethodology: InsightMethodology = {
    name: 'Section trend analysis',
    description: 'Tracks median performance on frequently visited sections over time.',
  };

  // Summary insight: show improving sections positively
  if (total >= 2 && improving.length > 0) {
    insights.push(
      makeInsight({
        id: 'section_trend-summary',
        category: 'section_pr',
        priority: 3,
        icon: 'chart-timeline-variant-shimmer',
        iconColor: '#66BB6A',
        title: t('insights.sectionTrendSummary', {
          improving: improving.length,
          total,
        }),
        body: t('insights.sectionTrendSummaryBody', {
          improving: improving.length,
          stable: stable.length,
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

  // Individual section improving — only show when the summary card was NOT generated,
  // to avoid displaying both "1 of N improving" and "Section X getting faster".
  if (!(total >= 2 && improving.length > 0)) {
    const topImproving = improving.sort((a, b) => b.traversalCount - a.traversalCount).slice(0, 1);

    for (const section of topImproving) {
      // Don't duplicate if we already have a PR insight for this section
      if (insights.some((i) => i.id === `section_pr-${section.sectionId}`)) continue;

      insights.push(
        makeInsight({
          id: `section_trend-improving-${section.sectionId}`,
          category: 'section_pr',
          priority: 3,
          icon: 'trending-up',
          iconColor: '#66BB6A',
          title: t('insights.sectionImproving', { name: section.sectionName }),
          body: t('insights.sectionImprovingBody', {
            name: section.sectionName,
            median: formatDuration(section.medianRecentSecs),
            best: formatDuration(section.bestTimeSecs),
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
                sportType: section.sportType,
              },
            ],
          },
          methodology: trendMethodology,
        })
      );
    }
  }
}

// ---------------------------------------------------------------------------
// Priority 3: Training consistency (actual consecutive weeks)
// Lally et al., 2010; Kaushal & Rhodes, 2015; Silverman & Barasch, 2023
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

  // Count actual consecutive weeks with 3+ activities
  let streakWeeks = 0;
  if (cur.count >= CONSISTENCY_MIN_ACTIVITIES) streakWeeks++;
  if (prev.count >= CONSISTENCY_MIN_ACTIVITIES) streakWeeks++;

  // With only 2 weeks of data, we can check both
  if (streakWeeks < 2) {
    // Not enough consecutive weeks — but never show broken streaks
    // If current week is on track, show positive partial framing
    if (cur.count >= CONSISTENCY_MIN_ACTIVITIES) {
      // One good week doesn't qualify as a streak, skip
      return;
    }
    // Show "X of last Y weeks" if at least one week has data
    if (cur.count > 0 || prev.count >= CONSISTENCY_MIN_ACTIVITIES) {
      const goodWeeks =
        (cur.count >= CONSISTENCY_MIN_ACTIVITIES ? 1 : 0) +
        (prev.count >= CONSISTENCY_MIN_ACTIVITIES ? 1 : 0);
      if (goodWeeks > 0) {
        insights.push(
          makeInsight({
            id: 'training_consistency-partial',
            category: 'training_consistency',
            priority: 3,
            icon: 'calendar-check',
            iconColor: '#42A5F5',
            title: t('insights.consistencyPartial', { good: goodWeeks, total: 2 }),
            timestamp: now,
            supportingData: {
              dataPoints: [
                {
                  label: t('insights.data.thisWeek'),
                  value: cur.count,
                  unit: t('insights.data.activities'),
                },
                {
                  label: t('insights.data.lastWeek'),
                  value: prev.count,
                  unit: t('insights.data.activities'),
                },
              ],
            },
            methodology: {
              name: 'Training consistency',
              description:
                'Tracks weeks with 3+ training sessions. Weekly session counts are more predictive of habit formation than daily streaks (Kaushal & Rhodes, 2015).',
              references: [
                {
                  citation:
                    'Kaushal, N., & Rhodes, R. E. (2015). Exercise habit formation in new gym members: A longitudinal study. Journal of Behavioral Medicine, 38(4), 652–663.',
                  url: 'https://pubmed.ncbi.nlm.nih.gov/25851609/',
                },
              ],
            },
          })
        );
      }
    }
    return;
  }

  // 2+ consecutive weeks — show streak
  insights.push(
    makeInsight({
      id: 'training_consistency-streak',
      category: 'training_consistency',
      priority: 3,
      icon: 'fire',
      iconColor: '#FF7043',
      title: t('insights.consistencyStreak', { count: streakWeeks }),
      timestamp: now,
      supportingData: {
        dataPoints: [
          {
            label: t('insights.data.thisWeek'),
            value: cur.count,
            unit: t('insights.data.activities'),
          },
          {
            label: t('insights.data.lastWeek'),
            value: prev.count,
            unit: t('insights.data.activities'),
          },
        ],
      },
      methodology: {
        name: 'Training consistency',
        description:
          'Tracks consecutive weeks with 3+ training sessions. Weekly session counts are more predictive of habit formation than daily streaks. Missing one session does not derail habit formation (Lally et al. 2010, median 66 days to automaticity).',
        references: [
          {
            citation:
              'Lally, P., van Jaarsveld, C. H. M., Potts, H. W. W., & Wardle, J. (2010). How are habits formed: Modelling habit formation in the real world. European Journal of Social Psychology, 40(6), 998–1009.',
            url: 'https://doi.org/10.1002/ejsp.674',
          },
          {
            citation:
              'Kaushal, N., & Rhodes, R. E. (2015). Exercise habit formation in new gym members: A longitudinal study. Journal of Behavioral Medicine, 38(4), 652–663.',
            url: 'https://pubmed.ncbi.nlm.nih.gov/25851609/',
          },
        ],
      },
    })
  );
}

// ---------------------------------------------------------------------------
// Priority 4: Activity patterns
// Michie S et al., 2009: Self-monitoring is the strongest BCT
// ---------------------------------------------------------------------------

function addActivityPatternInsights(
  insights: Insight[],
  todayPattern: ActivityPattern | null,
  allPatterns: ActivityPattern[],
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

  // Build weekly pattern sparkline: activity count per day of week (0=Mon..6=Sun)
  const weeklySparkline = [0, 0, 0, 0, 0, 0, 0];
  for (const p of allPatterns) {
    if (p.primaryDay >= 0 && p.primaryDay <= 6 && p.confidence >= 0.3) {
      weeklySparkline[p.primaryDay] += p.activityCount;
    }
  }

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
        sparklineData: weeklySparkline,
        sparklineLabel: 'typical_week',
      },
      methodology: {
        name: 'K-means clustering',
        description:
          'Groups your activities by day, duration, and sport type to identify recurring training patterns.',
        references: [
          {
            citation:
              'Michie, S., Abraham, C., Whittington, C., McAteer, J., & Gupta, S. (2009). Effective techniques in healthy eating and physical activity interventions: A meta-regression. Health Psychology, 28(6), 690–701.',
            url: 'https://pubmed.ncbi.nlm.nih.gov/19916637/',
          },
          {
            citation:
              'Chevance, G., Hekler, E. B., Elavsky, S., Pel-Littel, R., & Buman, M. P. (2024). A behavioral perspective for digital interventions targeting physical activity. Sports Medicine - Open, 10, 71.',
          },
        ],
      },
    })
  );
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
