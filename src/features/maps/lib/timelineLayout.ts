export const ONE_YEAR_MS = 365.25 * 24 * 60 * 60 * 1000;

/** Older-year counts up to each bound give the recent twelve months the paired share of the track. */
const RECENT_SHARE_BANDS: readonly (readonly [number, number])[] = [
  [5, 0.5],
  [10, 0.35],
  [20, 0.25],
];
const MIN_RECENT_SHARE = 0.2;
const ALL_QUARTER_LABELS_MIN_SHARE = 0.4;
const BAND_EPSILON = 1e-9;

function recentShareFor(olderYears: number): number {
  for (const [maxOlderYears, share] of RECENT_SHARE_BANDS) {
    if (olderYears <= maxOlderYears + BAND_EPSILON) return share;
  }
  return MIN_RECENT_SHARE;
}

/** Moves a date by whole calendar months, clamping the day to the target month's length. */
export function addCalendarMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getDate();
  result.setDate(1);
  result.setMonth(result.getMonth() + months);
  const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
  result.setDate(Math.min(day, lastDay));
  return result;
}

const LABEL_WIDTH_PX = 28;
const LABEL_GAP_PX = 4;
const MIN_LABEL_SPACING_PX = LABEL_WIDTH_PX + LABEL_GAP_PX;
const YEAR_LABEL_INTERVALS = [1, 2, 5] as const;
const MAX_YEAR_LABEL_INTERVAL = 10;
const SNAP_THRESHOLD = 0.08;
const SNAP_EPSILON = 1e-9;

export type TimelineTickKind = 'year' | 'quarter' | 'now';

export interface TimelineSnapPoint {
  position: number;
  date: Date;
  kind: TimelineTickKind;
  showLabel: boolean;
}

export interface TimelineLayout {
  recentShare: number;
  dateToPosition: (date: Date) => number;
  positionToDate: (pos: number) => Date;
  snapPoints: TimelineSnapPoint[];
  snapToNearest: (pos: number, maxPosition?: number) => { position: number; snapped: boolean };
}

interface TimelineLayoutInput {
  minDate: Date;
  maxDate: Date;
  trackWidth: number;
}

/**
 * Non-linear timeline scale: the last twelve months take a share of the track that shrinks as
 * the history lengthens, and the older history is spread evenly over the rest, one tick per
 * 1 January.
 */
export function createTimelineLayout({
  minDate,
  maxDate,
  trackWidth,
}: TimelineLayoutInput): TimelineLayout {
  const maxTime = maxDate.getTime();
  const minTime = minDate.getTime();
  const oneYearAgoTime = maxTime - ONE_YEAR_MS;
  const olderYears = Math.max(0, (oneYearAgoTime - minTime) / ONE_YEAR_MS);
  // A history under a year has no older half: the recent section takes the whole track.
  const hasOlder = olderYears > 0;
  const recentShare = hasOlder ? recentShareFor(olderYears) : 1;
  const recentStartPos = 1 - recentShare;
  const recentStartTime = hasOlder ? oneYearAgoTime : minTime;
  const recentSpanMs = maxTime - recentStartTime;
  const positionPerYear = hasOlder ? recentStartPos / olderYears : 0;

  const dateToPosition = (date: Date): number => {
    const time = date.getTime();
    if (time >= recentStartTime) {
      if (recentSpanMs <= 0) return 1;
      const recentProgress = Math.min(1, (time - recentStartTime) / recentSpanMs);
      return recentStartPos + recentProgress * recentShare;
    }
    const yearsFromOneYearAgo = (oneYearAgoTime - time) / ONE_YEAR_MS;
    return Math.max(0, recentStartPos - yearsFromOneYearAgo * positionPerYear);
  };

  const positionToDate = (pos: number): Date => {
    const exact = snapPoints.find(
      (p) => p.kind === 'year' && Math.abs(p.position - pos) < SNAP_EPSILON
    );
    if (exact) return new Date(exact.date.getTime());
    if (pos >= recentStartPos) {
      const recentProgress = (pos - recentStartPos) / recentShare;
      return new Date(
        Math.max(minTime, Math.min(recentStartTime + recentProgress * recentSpanMs, maxTime))
      );
    }
    const yearsFromOneYearAgo = (recentStartPos - pos) / positionPerYear;
    return new Date(Math.max(oneYearAgoTime - yearsFromOneYearAgo * ONE_YEAR_MS, minTime));
  };

  const yearDates: Date[] = [];
  if (hasOlder) {
    yearDates.push(new Date(minTime));
    // A year tick sits on 1 January of the year it names, so snapping to it fetches the whole year.
    for (let year = minDate.getFullYear() + 1; ; year++) {
      const date = new Date(year, 0, 1);
      if (date.getTime() > oneYearAgoTime) break;
      if (date.getTime() > minTime) yearDates.push(date);
    }
  }
  const pixelsPerYear = hasOlder ? (trackWidth * recentStartPos) / olderYears : Infinity;
  const yearInterval =
    YEAR_LABEL_INTERVALS.find((n) => n * pixelsPerYear >= MIN_LABEL_SPACING_PX) ??
    MAX_YEAR_LABEL_INTERVAL;

  // A label falls on a calendar year divisible by the interval and only when it clears the
  // previous visible label; every year keeps its snap point either way.
  let lastLabelPx = -Infinity;
  const snapPoints: TimelineSnapPoint[] = yearDates.map((date, i) => {
    const position = i === 0 ? 0 : dateToPosition(date);
    const px = position * trackWidth;
    const showLabel =
      date.getFullYear() % yearInterval === 0 && px - lastLabelPx >= MIN_LABEL_SPACING_PX - 1e-6;
    if (showLabel) lastLabelPx = px;
    return { position, date, kind: 'year', showLabel };
  });

  for (let i = 1; i <= 3; i++) {
    const date = new Date(maxTime);
    date.setMonth(date.getMonth() - (12 - i * 3));
    date.setDate(1);
    if (date.getTime() < minTime) continue;
    snapPoints.push({
      position: hasOlder ? recentStartPos + (i / 4) * recentShare : dateToPosition(date),
      date,
      kind: 'quarter',
      showLabel: recentShare >= ALL_QUARTER_LABELS_MIN_SHARE || i === 2,
    });
  }

  snapPoints.push({ position: 1, date: maxDate, kind: 'now', showLabel: true });

  // A point captures only a quarter of the gap to its nearer neighbour, so a position midway
  // between two points is never moved however many points the track holds.
  const sortedPositions = snapPoints.map((p) => p.position).sort((a, b) => a - b);
  const thresholds = sortedPositions.map((position, i) => {
    let gap = Infinity;
    for (const j of [i - 1, i + 1]) {
      const other = sortedPositions[j];
      if (other === undefined) continue;
      const d = Math.abs(position - other);
      if (d > 0 && d < gap) gap = d;
    }
    return { position, threshold: Math.min(SNAP_THRESHOLD, gap / 4) };
  });

  // A caller that may only move left passes the right-hand limit, so a point beyond it never captures.
  const snapToNearest = (
    pos: number,
    maxPosition = Infinity
  ): { position: number; snapped: boolean } => {
    let closestPoint = pos;
    let closestDistance = Infinity;
    for (const { position, threshold } of thresholds) {
      if (position > maxPosition + SNAP_EPSILON) continue;
      const distance = Math.abs(pos - position);
      if (distance < closestDistance && distance < threshold) {
        closestDistance = distance;
        closestPoint = position;
      }
    }
    return { position: closestPoint, snapped: closestPoint !== pos };
  };

  return {
    recentShare,
    dateToPosition,
    positionToDate,
    snapPoints,
    snapToNearest,
  };
}
