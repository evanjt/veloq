import type { Insight, InsightCategory, InsightPriority } from '@/types';

/**
 * Insight priority ranking (1 = highest):
 * 1. Section PRs set in last 7 days (Veloq's unique differentiator)
 * 2. Fitness milestones (FTP increase, pace improvement, peak CTL)
 * 3. Period comparisons (this week vs last — volume, TSS, frequency)
 * 4. Activity patterns (from Rust k-means — "Tuesdays you usually ride ~1h30")
 * 5. Training consistency + form advice (streak detection, form zones)
 *
 * Academic citations:
 * - Temporal self-comparison enhances intrinsic motivation (Kappen et al., Computers in Human Behavior, 2018)
 * - Goal attainment feedback is the strongest predictor of continued exercise behaviour (Rhodes & Kates, IRSEP, 2015)
 * - Behavioural pattern awareness supports autonomous motivation (Teixeira et al., IJBNPA, 2012)
 * - Medium gamification outperforms high gamification by 19% (Hammedi et al., Frontiers in Psychology, 2025)
 * - Hedonic value more strongly predicts sustained engagement than utility (PMC, 2025)
 */

// ---------------------------------------------------------------------------
// Input types — these match what the FFI functions return
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

  addSectionPRInsights(insights, data.recentPRs, now, t);
  addSectionTrendInsights(insights, data.sectionTrends, now, t);
  addFitnessMilestoneInsights(insights, data, now, t);
  addPeriodComparisonInsights(insights, data, now, t);
  addActivityPatternInsights(insights, data.todayPattern, now, t);
  addConsistencyInsights(insights, data, now, t);
  addFormAdviceInsight(insights, data.formTsb, data.formCtl, data.formAtl, now, t);

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
        iconColor: '#FC4C02',
        title: t('insights.sectionPr', { name: pr.sectionName }),
        subtitle: t('insights.sectionPrSubtitle', {
          time: formatDurationCompact(pr.bestTime),
          daysAgo: pr.daysAgo,
        }),
        navigationTarget: `/section/${pr.sectionId}`,
        timestamp: now,
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
  const total = sectionTrends.length;

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
          stable: sectionTrends.filter((s) => s.trend === 0).length,
          declining: declining.length,
          names: improving
            .slice(0, 3)
            .map((s) => s.sectionName)
            .join(', '),
        }),
        navigationTarget: '/routes',
        timestamp: now,
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

  // Both weeks meet the threshold — count as a 2-week streak at minimum
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
}

function makeInsight(fields: InsightFields): Insight {
  return { ...fields, isNew: true };
}

/** Format seconds to compact duration string (e.g., "1h30" or "45m"). */
export function formatDurationCompact(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0m';
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return m > 0 ? `${h}h${String(m).padStart(2, '0')}` : `${h}h`;
  return `${m}m`;
}
