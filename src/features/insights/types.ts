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
export type DataPointKey = 'hrvAverage' | 'hrvLatest' | 'hrChange' | 'effortCount';

export interface DataPoint {
  /** Set where a sheet or the card reads this value back by name. */
  key?: DataPointKey | undefined;
  label: string;
  value: number | string;
  unit?: string | undefined;
  context?: 'good' | 'warning' | 'concern' | 'neutral' | undefined;
  /** The day the value was read, epoch seconds at UTC midnight of that day. */
  date?: number | undefined;
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
  standingCount?: number | undefined;
  percentileFaster?: number | undefined;
  previousBestTime?: number | undefined;
  previousBestDate?: number | undefined;
  deltaSeconds?: number | undefined;
  sportType?: string | undefined;
  daysSinceLast?: number | undefined;
  ranking?: SectionRankingScores | undefined;
  /** The section's line, thinned by the engine for the sheet's thumbnail. */
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
  /** The recent median time minus the previous one, seconds, negative faster; absent with no trend. */
  trendSeconds?: number | undefined;
  /** The fastest counted attempt's moving time, seconds. */
  bestTime: number;
  daysSinceLast: number;
  attemptCount: number;
  /** The last counted attempts' moving times, oldest first. */
  recentEfforts?: SeriesPoint[] | undefined;
  navigationTarget: string;
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

export type HistoryMark = { date: number } | { from: number; to: number };

export interface HistorySeries {
  label: string;
  points: SeriesPoint[];
  /** The symbol a value of the series is read in, printed after it; none prints it bare. */
  unit?: string | undefined;
  /** Prints a value as the card's scale printed it, for the sheet's ticks and readout. */
  format?: ((value: number) => string) | undefined;
}

/**
 * One signed bar in a card's changes: what `key` names, the change the engine
 * measured for it, above zero the better way.
 */
export interface HistoryChange {
  key: string;
  value: number;
}

export type InsightHistory =
  | {
      kind: 'timeline' | 'sparkline' | 'bars';
      series: HistorySeries[];
      mark?: HistoryMark;
      target: string;
    }
  | {
      kind: 'line';
      points: LatLngShort[];
      target: string;
    }
  | {
      /**
       * One bar per row of the card's sheet, in the rows' order. It pictures
       * the rows themselves, so it opens no screen and carries no target.
       */
      kind: 'changes';
      bars: HistoryChange[];
    };

/**
 * One section a stale-PR card offers, as its sheet draws it while that
 * section is the one selected. Every figure is the section's own.
 */
export interface StalePrSheetSection {
  sectionId: string;
  sportType?: string | undefined;
  /** The section's own name, as the screen-reader action names it. */
  sectionName: string;
  /** The section's name with its sport, for the selector and the chart title. */
  name: string;
  /** How often the section was done, in the sport's own verb. */
  visited: string;
  /** How many times, which the selector draws beside the name. */
  traversalCount: number;
  /** When and at what fitness the record was set, and the fitness now. */
  summary: string;
  /** The record effort's power or pace and its share of that day's fitness. Absent when unknown. */
  effort?: string | undefined;
  /** The fitness from the first effort drawn to now, with a point on the record's day. */
  fitness: HistorySeries;
  /** The section's efforts, the record among them. */
  efforts: HistorySeries;
  /** The record's day, epoch seconds. */
  prDate: number;
  /** The chart's time axis, epoch seconds, shared by both series. */
  range: { from: number; to: number };
  /** From the last visit to now, which the chart shades. Absent with no visit drawn. */
  gap?: { from: number; to: number } | undefined;
  /** Says what the shaded gap is. */
  gapLabel: string;
  /** The section's screen, opened on the record's activity. */
  sectionTarget: string;
  /** The record's activity, absent when the engine did not match one. */
  activityTarget?: string | undefined;
}

export interface InsightSupportingData {
  /** The sections a stale-PR card offers, most visited first. */
  stalePrSections?: StalePrSheetSection[] | undefined;
  /**
   * The one figure the sheet leads with, the value the card's claim rests on.
   * Absent where the payload carries no single figure for the card.
   */
  hero?: DataPoint | undefined;
  dataPoints?: DataPoint[];
  sections?: SupportingSection[];
  routes?: SupportingRoute[];
  history?: InsightHistory;
  /**
   * The screen holding the series the card was read from, kept when the
   * series is too short to draw so the data link opens the same place.
   */
  dataTarget?: string | undefined;
  /**
   * The change the card states beside its figure when it has no history to
   * draw, coloured by `trend`. Absent where the card reports no change.
   */
  change?: DataPoint | undefined;
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
  /**
   * The one sentence the list row draws: what changed, then the figures that
   * say by how much. `title` and `subtitle` stay for the sheet and the widget.
   */
  line: string;
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
  /**
   * The insight comes from a method still being proven. It is generated only
   * with the developer switch on, and the card says so.
   */
  experimental?: boolean;
}

// --- Generator input shapes ---

export interface PeriodStats {
  count: number;
  totalDuration: number; // seconds
  totalDistance: number; // meters
  totalTss: number;
}

export interface WeeklyTotal {
  start: number;
  stats: PeriodStats;
  /** The week is still running, so its totals cover only the days so far. */
  partial: boolean;
}

/**
 * One period against an earlier one, as the engine took it. The ratio and the
 * metric it is under are `insights_data`'s; whether the gap is worth a card is
 * the generator's.
 */
export interface PeriodComparison {
  /** Which total both values are under. */
  metric: 'tss' | 'duration';
  /** The later period's total, in training load or in seconds. */
  current: number;
  /** The earlier period's total, on the same metric. */
  previous: number;
  /** `current / previous - 1`, so 0.28 is 28% more than the period before. */
  ratio: number;
  /** Epoch seconds where the later period starts, the week a graphic marks. */
  comparedStart: number;
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
  activityId?: string | undefined;
  /** A total still accruing, such as the running week's. */
  partial?: boolean | undefined;
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
  /** Those days, oldest first, for the insight's history. */
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
  /** Those snapshots, oldest first, for the insight's history. */
  history?: SeriesPoint[];
}

export interface SectionPR {
  sectionId: string;
  sectionName: string;
  bestTime: number;
  daysAgo: number;
  /** The sport the record was set in, which is not always the section's own. */
  sportType?: string;
  // Traversals in that sport, used for the card's confidence.
  traversalCount: number;
  // Timed, eligible laps in the record's direction.
  standingCount?: number;
  percentileFaster?: number | undefined;
  previousBestTime?: number | undefined;
  previousBestDate?: number | undefined;
  deltaSeconds?: number | undefined;
  /** The last efforts on the section, oldest first, for the insight's history. */
  recentEfforts?: SeriesPoint[];
  bestActivityId?: string | undefined;
  /** The section's line, thinned by the engine for the sheet's thumbnail. */
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
  ranking?: SectionRankingScores | undefined;
  /** The last efforts on the section, oldest first, for the insight's history. */
  recentEfforts?: SeriesPoint[] | undefined;
}

/** Translation function signature (react-i18next-compatible). */
export type TFunc = (key: string, params?: Record<string, string | number>) => string;
