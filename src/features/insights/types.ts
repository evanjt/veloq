import type { FfiImprovementBasis } from 'veloqrs';
import type { InsightTone } from '@/theme';
import type { TrendDirection, TrendVerdict } from '@/shared/format/trend';
import type { LatLngShort } from '@/shared/geo/distance';

export type InsightCategory =
  | 'section_pr'
  | 'section_trend'
  | 'route'
  | 'stale_pr'
  | 'fitness_milestone'
  | 'period_comparison'
  | 'strength_progression'
  | 'strength_balance'
  | 'hrv_trend'
  | 'efficiency_trend'
  | 'section_changed';

export type InsightPriority = 1 | 2 | 3 | 4 | 5;

/**
 * What a value is, for a reader that needs one value by name. The label is
 * translated, so a reader that matched it found nothing outside English.
 */
export type DataPointKey = 'hrvAverage' | 'hrvLatest' | 'hrChange' | 'effortCount' | 'balanceRatio';

export interface DataPoint {
  /** Set where a sheet or the card reads this value back by name. */
  key?: DataPointKey | undefined;
  label: string;
  value: number | string;
  unit?: string | undefined;
  context?: 'good' | 'warning' | 'concern' | 'neutral' | undefined;
}

export interface InsightAlternative {
  key: string;
  label: string;
  isSelected: boolean;
  reasoning: string;
  thresholds?: DataPoint[];
}

export interface InsightMethodology {
  name: string;
  description: string;
  formula?: string;
}

/**
 * The engine's composite relevance breakdown for one section, all 0..1.
 * `relevance` is the composite the ranker sorts on, the other four are the
 * components it weighs. Weights live in Rust
 * (`persistence/sections/ranking.rs`) and are not restated here.
 */
export interface SectionRankingScores {
  relevance: number;
  recency: number;
  improvement: number;
  anomaly: number;
  engagement: number;
  /**
   * The signed fraction the athlete got faster by before `improvement` clamps
   * it: +0.14 is 14% faster, -1.5 is 150% slower. Absent when the engine
   * compared nothing, which is not a 0% change.
   */
  improvementChange?: number | undefined;
  /** What `improvementChange` compares. Absent when it is. */
  improvementBasis?: FfiImprovementBasis | undefined;
}

export interface SupportingSection {
  sectionId: string;
  sectionName: string;
  bestTime?: number | undefined;
  trend?: number | undefined;
  traversalCount?: number | undefined;
  sportType?: string | undefined;
  hasRecentPR?: boolean | undefined;
  daysSinceLast?: number | undefined;
  ranking?: SectionRankingScores | undefined;
  /** The section's line, thinned by the engine for the card's thumbnail. */
  previewPoints?: LatLngShort[] | undefined;
}

/**
 * One route bucket an insight lists: a route in one sport and one direction,
 * as the engine's insights read carried it.
 */
export interface SupportingRoute {
  /** One row per route, sport and direction: the React key. */
  rowKey: string;
  routeId: string;
  routeName: string;
  sportType: string;
  /**
   * Set only where the list holds the route's other direction too, or this is
   * the reverse one, so a route ridden one way carries no label.
   */
  direction?: 'forward' | 'reverse' | undefined;
  isRecentRecord: boolean;
  /** -1 slower, 0 stable, 1 faster. */
  trend: number;
  /** The fastest counted attempt's moving time, seconds. */
  bestTime: number;
  daysSinceLast: number;
  attemptCount: number;
  /** The last counted attempts' moving times, oldest first. */
  recentEfforts?: SeriesPoint[] | undefined;
  navigationTarget: string;
}

export interface SupportingActivity {
  activityId: string;
  activityName: string;
  date: string;
  duration?: number;
  sportType?: string;
}

/**
 * The move a card reports, judged where the metric is known. A surface draws
 * the glyph and the rung from this and never from the sign of a number, which
 * is what drew a falling efficiency ratio, the good news, in red.
 */
export interface SupportingTrend {
  direction: TrendDirection;
  verdict: TrendVerdict;
}

export interface InsightSupportingData {
  dataPoints?: DataPoint[];
  sections?: SupportingSection[];
  routes?: SupportingRoute[];
  activities?: SupportingActivity[];
  sparklineData?: number[];
  sparklineLabel?: string;
  /** The direction and verdict of the series or comparison the card reports. */
  trend?: SupportingTrend | undefined;
  comparisonData?: {
    current: DataPoint;
    previous: DataPoint;
    change: DataPoint;
  };
  formula?: string;
  algorithmDescription?: string;
}

export interface InsightMeta {
  /**
   * Epoch ms when the triggering event occurred (PR date, trend-window end,
   * milestone date). Drives the recency gate (G1). Falls back to
   * `Insight.timestamp` (generation time) when unset - treat unset as "fresh".
   */
  sourceTimestamp?: number | undefined;
  /**
   * 'self' compares the user to their own past (Kappen 2018 - preferred).
   * 'other' compares to population/others. 'none' for pure status facts.
   */
  comparisonKind?: 'self' | 'other' | 'none' | undefined;
  /** Lifetime count of the repeated behaviour - drives repetition gate (G3). */
  repetitionCount?: number | undefined;
  /** The section this insight is about, which is what R9's scores are keyed on. */
  sectionId?: string | undefined;
  /** What the engine rates that section, filled in by the pipeline for R9. */
  ranking?: SectionRankingScores | undefined;
  /**
   * The place this insight is about, as the generator knows it. R5 credits it
   * only when it survives into the rendered copy, so this is the name to look
   * for and not an assertion that it is there.
   */
  placeName?: string | undefined;
  /** Optional signal-to-noise delta (|value − baseline| / stddev) - drives R6. */
  signalDelta?: number | undefined;
}

export interface Insight {
  id: string;
  category: InsightCategory;
  priority: InsightPriority;
  title: string;
  subtitle?: string;
  icon: string;
  iconTone: InsightTone;
  body?: string;
  navigationTarget?: string | undefined;
  timestamp: number;
  isNew: boolean;
  alternatives?: InsightAlternative[];
  supportingData?: InsightSupportingData | undefined;
  methodology?: InsightMethodology;
  /**
   * R4 - how much population the claim stands on, 0 to 1, or `null` where the
   * generator has none to count. Absent only on a hand-built insight, and the
   * ranker scores that as the absence it is rather than substituting a middle.
   */
  confidence?: number | null;
  meta?: InsightMeta;
}

// --- Generator input shapes ---

export interface PeriodStats {
  count: number;
  totalDuration: number; // seconds
  totalDistance: number; // meters
  totalTss: number;
}

/**
 * One period against an earlier one, as the engine took it. The ratio and the
 * metric it is under are `insights_data`'s; whether the gap is worth a card is
 * the generator's.
 */
export interface PeriodComparison {
  /** Which total both values are under. */
  metric: 'tss' | 'duration';
  /** The later period's total, in TSS or in seconds. */
  current: number;
  /** The earlier period's total, on the same metric. */
  previous: number;
  /** `current / previous - 1`, so 0.28 is 28% more than the period before. */
  ratio: number;
}

/**
 * One point of a history series, as the engine sends it.
 *
 * Every card draws a graphic of its own history. The points come from the read
 * that already holds them rather than from a second read per open sheet, and
 * nothing here derives them: the card draws what the engine sent.
 */
export interface SeriesPoint {
  value: number;
  /** Epoch seconds. */
  date: number;
}

export interface FtpTrend {
  latestFtp?: number | undefined;
  latestDate?: bigint | number | undefined;
  previousFtp?: number | undefined;
  previousDate?: bigint | number | undefined;
  /** The step in watts, with its sign, as the engine derived it. */
  deltaWatts?: number | undefined;
  /** Days of estimate from the one compared against to the newest. */
  sampleCount?: number | undefined;
  /** Those days, oldest first, for the card's graphic. */
  history?: SeriesPoint[] | undefined;
}

export interface PaceTrend {
  latestPace?: number;
  latestDate?: bigint | number;
  previousPace?: number;
  previousDate?: bigint | number;
  /** The move as a percent of the earlier speed, positive for faster. */
  gainPercent?: number;
  /** The same move in the unit the sport is paced in, seconds saved. */
  deltaSeconds?: number;
  /** Snapshots the trend was read from. */
  sampleCount?: number;
  /** Those snapshots, oldest first, for the card's graphic. */
  history?: SeriesPoint[];
}

export interface SectionPR {
  sectionId: string;
  sectionName: string;
  bestTime: number;
  daysAgo: number;
  /** The sport the record was set in, which is not always the section's own. */
  sportType?: string;
  /** Traversals in that sport, the population the record stands on. */
  traversalCount: number;
  /** The last efforts on the section, oldest first, for the card's graphic. */
  recentEfforts?: SeriesPoint[];
  /** The section's line, thinned by the engine for the card's thumbnail. */
  previewPoints?: LatLngShort[];
}

export interface SectionTrendData {
  sectionId: string;
  sectionName: string;
  /** -1=declining, 0=stable, 1=improving */
  trend: number;
  medianRecentSecs: number;
  bestTimeSecs: number;
  traversalCount: number;
  sportType?: string | undefined;
  daysSinceLast?: number | undefined;
  latestIsPr?: boolean | undefined;
  ranking?: SectionRankingScores | undefined;
  /** The last efforts on the section, oldest first, for the card's graphic. */
  recentEfforts?: SeriesPoint[] | undefined;
}

/** Translation function signature (react-i18next-compatible). */
export type TFunc = (key: string, params?: Record<string, string | number>) => string;
