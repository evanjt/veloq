/**
 * What a screen reader says for a value the screen draws in short form.
 *
 * A screen reader reads an accessible name as written, so '1:30' is spoken as
 * a clock time, '5:33 /km' as a ratio and '↑' as "up arrow" even when it marks
 * a pace that fell. Each function here is the spoken twin of a visual
 * formatter: it takes the same input, reaches the same quantity through the
 * same arithmetic, and says it in words in the app's language. Where the
 * visual form shows its absent mark, the spoken form says no value.
 */

import { i18n } from '@/i18n';

import {
  distanceParts,
  elevationValue,
  getIntlLocale,
  MAX_DURATION_SECONDS,
  paceSeconds,
  splitMinSec,
  swimPaceSeconds,
  type DistanceUnit,
} from './format';
import type { TrendDirection, TrendVerdict } from './trend';

function noValue(): string {
  return i18n.t('spoken.noValue');
}

const COUNT_KEY = {
  hours: 'spoken.hours',
  minutes: 'spoken.minutes',
  seconds: 'spoken.seconds',
} as const;

function count(unit: keyof typeof COUNT_KEY, n: number): string {
  return i18n.t(COUNT_KEY[unit], { count: n });
}

/** Minutes and seconds in words, dropping a zero part: "5 minutes 33 seconds". */
function minutesAndSeconds(totalSeconds: number): string {
  const { minutes, seconds } = splitMinSec(totalSeconds);
  if (minutes === 0) return count('seconds', seconds);
  if (seconds === 0) return count('minutes', minutes);
  return `${count('minutes', minutes)} ${count('seconds', seconds)}`;
}

/**
 * A duration in words, the twin of `formatDuration`: "1 hour 1 minute 5
 * seconds" for '1:01:05', each zero part dropped, so an hour is "1 hour".
 */
export function spokenDuration(seconds: number | null | undefined): string {
  if (seconds == null || !Number.isFinite(seconds) || seconds < 0) return noValue();
  if (seconds > MAX_DURATION_SECONDS) return noValue();
  const whole = Math.floor(seconds);
  const hours = Math.floor(whole / 3600);
  const minutes = Math.floor((whole % 3600) / 60);
  const secs = whole % 60;

  const parts: string[] = [];
  if (hours > 0) parts.push(count('hours', hours));
  if (minutes > 0) parts.push(count('minutes', minutes));
  if (secs > 0 || parts.length === 0) parts.push(count('seconds', secs));
  return parts.join(' ');
}

/** A pace in words, the twin of `formatPace`: "5 minutes 33 seconds per kilometre". */
export function spokenPace(metersPerSecond: number, isMetric: boolean): string {
  const totalSeconds = paceSeconds(metersPerSecond, isMetric);
  if (totalSeconds == null) return noValue();
  return i18n.t(isMetric ? 'spoken.perKilometre' : 'spoken.perMile', {
    value: minutesAndSeconds(totalSeconds),
  });
}

/** A swim pace in words, the twin of `formatSwimPace`: "1 minute 20 seconds per 100 metres". */
export function spokenSwimPace(metersPerSecond: number, isMetric: boolean): string {
  const totalSeconds = swimPaceSeconds(metersPerSecond, isMetric);
  if (totalSeconds == null) return noValue();
  return i18n.t(isMetric ? 'spoken.per100Metres' : 'spoken.per100Yards', {
    value: minutesAndSeconds(totalSeconds),
  });
}

const DISTANCE_KEY = {
  m: 'spoken.metres',
  km: 'spoken.kilometres',
  ft: 'spoken.feet',
  mi: 'spoken.miles',
} as const satisfies Record<DistanceUnit, string>;

function spokenNumber(value: number): string {
  return value.toLocaleString(getIntlLocale(), { maximumFractionDigits: 1 });
}

/** A distance in words, the twin of `formatDistance`, in the unit it chose: "1.5 kilometres". */
export function spokenDistance(meters: number | null | undefined, isMetric: boolean): string {
  const parts = meters == null ? null : distanceParts(meters, isMetric);
  if (!parts) return noValue();
  return i18n.t(DISTANCE_KEY[parts.unit], { count: parts.value, value: spokenNumber(parts.value) });
}

/** An elevation in words, the twin of `formatElevation`: "120 metres" or "394 feet". */
export function spokenElevation(meters: number | null | undefined, isMetric: boolean): string {
  const value = elevationValue(meters, isMetric);
  if (value == null) return noValue();
  return i18n.t(isMetric ? 'spoken.metres' : 'spoken.feet', {
    count: value,
    value: spokenNumber(value),
  });
}

/**
 * The judgement a trend glyph draws, in words. The glyph points up for an
 * improvement even when the number fell, so the spoken form says improved
 * rather than the arrow's direction, and only a move with no judgement is
 * spoken by its direction.
 */
export function spokenVerdict(verdict: TrendVerdict, direction: TrendDirection): string {
  if (verdict === 'improved') return i18n.t('spoken.improved');
  if (verdict === 'declined') return i18n.t('spoken.declined');
  if (verdict === 'moved' && direction === 'up') return i18n.t('spoken.rose');
  if (verdict === 'moved' && direction === 'down') return i18n.t('spoken.fell');
  return i18n.t('spoken.noChange');
}
