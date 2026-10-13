import { ABSENT } from './absent';
import { getIntlLocale } from './locale';

/**
 * Numbers as the app language writes them: its decimal separator, its digit
 * grouping and its percent spacing, so a value reads the same way as the
 * dates beside it. Every rendered decimal goes through here; logs, debug
 * screens and values sent to intervals.icu do not.
 */

const formats = new Map<string, Intl.NumberFormat>();

function numberFormat(style: 'decimal' | 'percent', digits: number): Intl.NumberFormat {
  const locale = getIntlLocale();
  const key = `${locale}|${style}|${digits}`;
  let format = formats.get(key);
  if (!format) {
    format = new Intl.NumberFormat(locale, {
      style,
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
    formats.set(key, format);
  }
  return format;
}

/** Whether `value` shows as zero at `digits` decimals, where a half rounds away from zero. */
function roundsToZero(value: number, digits: number): boolean {
  return Math.abs(value) < 0.5 * 10 ** -digits;
}

/**
 * A number to exactly `digits` decimals in the app locale, grouped. A missing
 * value prints the absent mark.
 *
 * ```ts
 * formatDecimal(1234.56, 1); // "1,234.6" in en-GB, "1.234,6" in de-DE
 * ```
 */
export function formatDecimal(value: number | null | undefined, digits: number): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  return numberFormat('decimal', digits).format(roundsToZero(value, digits) ? 0 : value);
}

/** A value with no decimals when it is whole, and `digits` when it is not. */
export function formatDecimalTrimmed(value: number | null | undefined, digits: number): string {
  if (value == null || !Number.isFinite(value)) return ABSENT;
  const factor = 10 ** digits;
  const rounded = Math.round(value * factor) / factor;
  return formatDecimal(rounded, Number.isInteger(rounded) ? 0 : digits);
}

/**
 * A percentage already on the 0 to 100 scale, with the locale's sign and spacing.
 *
 * ```ts
 * formatPercent(12.5, 1); // "12.5%" in en-GB, "12,5 %" in de-DE
 * ```
 */
export function formatPercent(percent: number, digits = 0): string {
  if (!Number.isFinite(percent)) return ABSENT;
  return numberFormat('percent', digits).format(roundsToZero(percent, digits) ? 0 : percent / 100);
}

/**
 * A signed change: a plus on a rise, the locale's minus on a fall, and no
 * sign on a value that rounds to zero, which is no change.
 *
 * ```ts
 * formatSigned(2, 1);     // "+2.0"
 * formatSigned(-0.03, 1); // "0.0"
 * ```
 */
export function formatSigned(value: number, digits: number): string {
  if (!Number.isFinite(value)) return ABSENT;
  const text = formatDecimal(value, digits);
  return value > 0 && !roundsToZero(value, digits) ? `+${text}` : text;
}

/**
 * A signed percentage already on the 0 to 100 scale, under the same rule as
 * `formatSigned`.
 */
export function formatSignedPercentage(percent: number, digits = 0): string {
  if (!Number.isFinite(percent)) return ABSENT;
  const text = formatPercent(percent, digits);
  return percent > 0 && !roundsToZero(percent, digits) ? `+${text}` : text;
}

/** A signed fraction as a whole percentage: +14%, 0%, -150%. A rounded zero has no sign. */
export function formatSignedPercent(fraction: number): string {
  return formatSignedPercentage(fraction * 100, 0);
}
