/**
 * Which mark each attempt on the scatter carries, and where the record's
 * staircase sits. The engine decides the range, the off-scale flags, the
 * record and each attempt's gap to it; this only reads those into marks, so
 * the chart draws what it is told and a point can carry several marks at once.
 *
 * One mark, one meaning: the reticle is this activity, a gold ring the record,
 * the gold staircase its progression, a triangle at the edge an attempt past
 * the range, and the selection a focus ring at a size no other mark uses.
 */

import type { TFunction } from 'i18next';
import type { FfiFocusRange, FfiRecordStep } from 'veloqrs';
import { isPaceSport, isSwimmingActivity } from '@/shared/activity/activityUtils';
import {
  formatDuration,
  formatSecondsValue,
  formatSpeed,
  paceSeconds,
  swimPaceSeconds,
} from '@/shared/format/format';
import type { ActivityType, PerformanceDataPoint } from '@/types';

/** How far from a point a tap still selects it, in pixels. */
export const TAP_REACH_PX = 24;

/** The share of the span added at each end of a range the engine did not give. */
const FALLBACK_PADDING = 0.12;
/** The share of the value added at each end when every point has the same one. */
const FALLBACK_FLAT_PADDING = 0.05;

/**
 * What a point is drawn as: a dot, a dimmed excluded attempt, a hollow route
 * attempt outside the distance band, or a triangle at the top or bottom edge
 * for an attempt past the range.
 */
export type ScatterMarkKind = 'dot' | 'excluded' | 'outsideBand' | 'offScaleTop' | 'offScaleBottom';

export interface ScatterMark {
  kind: ScatterMarkKind;
  /** Carries the gold record ring. */
  record: boolean;
  /** Carries the reticle. */
  thisActivity: boolean;
  /** Carries the focus ring. */
  selected: boolean;
}

export interface ScatterMarkContext {
  highlightedActivityId: string | undefined;
  /** The selected attempt's lap id and activity id, null with nothing selected. */
  selected: { id: string; activityId: string } | null;
  /** Every time stream is read, so the engine's record is the record. */
  recordsSettled: boolean;
}

/**
 * The marks one point carries. Faster is up on both axes the scatter draws, so
 * a fast attempt past the range sits at the top edge and a slow one at the
 * bottom. This activity is always on the axis, so it never takes a triangle.
 */
export function scatterMarkFor(point: PerformanceDataPoint, ctx: ScatterMarkContext): ScatterMark {
  const thisActivity =
    ctx.highlightedActivityId != null && point.activityId === ctx.highlightedActivityId;
  const excluded = point.isExcluded === true;
  const selected =
    ctx.selected != null &&
    ctx.selected.id === point.id &&
    ctx.selected.activityId === point.activityId;
  const record = ctx.recordsSettled && !excluded && point.isBest === true;
  let kind: ScatterMarkKind = 'dot';
  if (excluded) kind = 'excluded';
  else if (point.outsideDistanceBand === true) kind = 'outsideBand';
  if (!thisActivity && point.offScale === 'fast') kind = 'offScaleTop';
  if (!thisActivity && point.offScale === 'slow') kind = 'offScaleBottom';
  return { kind, record, thisActivity, selected };
}

/**
 * The value range the axis draws, low to high in the axis's own value. The
 * engine's focus range when the read carries one; else every drawn value,
 * padded, for a read that has no focus to give.
 */
export function scatterRange(
  focus: FfiFocusRange | undefined,
  drawnValues: readonly number[]
): [number, number] | null {
  if (focus && Number.isFinite(focus.low) && Number.isFinite(focus.high)) {
    return [focus.low, focus.high];
  }
  const finite = drawnValues.filter(Number.isFinite);
  if (finite.length === 0) return null;
  const low = Math.min(...finite);
  const high = Math.max(...finite);
  const span = high - low;
  const pad = span > 0 ? span * FALLBACK_PADDING : Math.abs(low) * FALLBACK_FLAT_PADDING || 1;
  return [low - pad, high + pad];
}

/** A value held inside the range, so a point past it is drawn at the edge. */
export function clampToRange(value: number, range: readonly [number, number]): number {
  return Math.min(Math.max(value, range[0]), range[1]);
}

/** One step of the staircase on the chart: its normalised x and its axis value. */
export interface PlacedStep {
  x: number;
  value: number;
}

export interface PlacedStaircase {
  /** The record held when the range opens, carried in from the left edge. Null when none. */
  carriedIn: number | null;
  /** The records set inside the range, oldest first. */
  steps: PlacedStep[];
}

/**
 * The record's progression placed on the chart's dates, which run 0.02 to 0.98
 * across the drawn attempts as each point does. Steps before the first drawn
 * date are not drawn; the level the last of them set is carried in from the
 * left edge. Every value is held inside the range.
 */
export function placeRecordStaircase(
  progression: readonly FfiRecordStep[],
  drawnDates: { first: Date; last: Date } | null,
  axis: 'speed' | 'time',
  range: readonly [number, number]
): PlacedStaircase {
  if (!drawnDates || progression.length === 0) return { carriedIn: null, steps: [] };
  const first = drawnDates.first.getTime();
  const span = drawnDates.last.getTime() - first || 1;
  const valueOf = (step: FfiRecordStep) => (axis === 'time' ? step.sectionTime : step.speed);
  let carriedIn: number | null = null;
  const steps: PlacedStep[] = [];
  for (const step of progression) {
    const at = step.activityDate * 1000;
    const value = clampToRange(valueOf(step), range);
    if (at < first) {
      carriedIn = value;
      continue;
    }
    steps.push({ x: 0.02 + ((at - first) / span) * 0.96, value });
  }
  return { carriedIn, steps };
}

/** How this activity stands against the record, in words the chart writes beside it. */
export type ScatterStanding =
  | { kind: 'newRecord'; gain: number | null }
  | { kind: 'offRecord'; gap: number }
  | null;

/**
 * This activity's standing from the engine's gap and progression: a new record
 * with what it gained on the record before, or how far off the record it is.
 * `gain` and `gap` are in the axis's own value, seconds on a time axis and
 * metres per second on a speed axis, and are never negative.
 */
export function scatterStanding(
  point: PerformanceDataPoint,
  progression: readonly FfiRecordStep[],
  axis: 'speed' | 'time'
): ScatterStanding {
  const gap = axis === 'time' ? point.recordGapSecs : point.recordGapSpeed;
  if (gap == null || !Number.isFinite(gap)) return null;
  if (point.isBest === true) {
    const step = progression.find((s) => s.lapId === point.id);
    const gain = axis === 'time' ? step?.improvementSecs : step?.improvementSpeed;
    return { kind: 'newRecord', gain: gain != null && Number.isFinite(gain) ? gain : null };
  }
  return gap > 0 ? { kind: 'offRecord', gap } : null;
}

/** A whole number of seconds as the chart writes a gap: "12 s", or "1:05" past a minute. */
function gapSeconds(seconds: number): string {
  const whole = Math.round(seconds);
  return whole < 60 ? formatSecondsValue(whole) : formatDuration(whole);
}

/**
 * A difference between two speeds in the unit the axis is read in: seconds
 * per kilometre or mile for a pace sport, per 100 m or 100 yd for a swim, and
 * speed otherwise. Null where one of the speeds has no pace.
 */
function speedDifference(
  slower: number,
  faster: number,
  activityType: ActivityType,
  isMetric: boolean
): string | null {
  if (isSwimmingActivity(activityType) || isPaceSport(activityType)) {
    const pace = isSwimmingActivity(activityType) ? swimPaceSeconds : paceSeconds;
    const a = pace(slower, isMetric);
    const b = pace(faster, isMetric);
    if (a == null || b == null) return null;
    const unit = isSwimmingActivity(activityType)
      ? isMetric
        ? '/100m'
        : '/100yd'
      : isMetric
        ? '/km'
        : '/mi';
    return `${gapSeconds(a - b)} ${unit}`;
  }
  return formatSpeed(faster - slower, isMetric);
}

/**
 * The words written beside this activity: "New record, +0.3 km/h", or
 * "1.2 km/h off the record", in the axis's unit. Null with nothing to say.
 */
export function scatterStandingText(
  standing: ScatterStanding,
  point: PerformanceDataPoint,
  axis: 'speed' | 'time',
  activityType: ActivityType,
  isMetric: boolean,
  t: TFunction
): string | null {
  if (!standing) return null;
  if (standing.kind === 'newRecord') {
    if (standing.gain == null || standing.gain <= 0) return t('sections.scatterNewRecordFirst');
    // A gain in speed reads with a plus; a gain in time or pace is time taken off.
    let gain: string | null;
    if (axis === 'time') gain = `-${gapSeconds(standing.gain)}`;
    else if (!isPaced(activityType)) gain = `+${formatSpeed(standing.gain, isMetric)}`;
    else {
      const taken = speedDifference(
        point.speed - standing.gain,
        point.speed,
        activityType,
        isMetric
      );
      gain = taken == null ? null : `-${taken}`;
    }
    return gain == null
      ? t('sections.scatterNewRecordFirst')
      : t('sections.scatterNewRecord', { gain });
  }
  const gap =
    axis === 'time'
      ? gapSeconds(standing.gap)
      : speedDifference(point.speed, point.speed + standing.gap, activityType, isMetric);
  return gap == null ? null : t('sections.scatterOffRecord', { gap });
}

function isPaced(activityType: ActivityType): boolean {
  return isSwimmingActivity(activityType) || isPaceSport(activityType);
}
