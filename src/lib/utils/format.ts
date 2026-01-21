/**
 * @fileoverview Formatting utilities for activity data and dates
 *
 * Provides consistent formatting for distances, durations, speeds, and dates
 * across the application. Handles localization and unit conversion.
 */

import { i18n, getCurrentLanguage } from '@/i18n';

/**
 * Map app locale codes to valid Intl/BCP 47 locale codes for date formatting.
 *
 * Some locales have custom codes that don't match standard BCP 47 format.
 * This function maps them to valid locale codes for use with Intl.DateTimeFormat.
 *
 * @returns Valid BCP 47 locale code
 *
 * @example
 * ```ts
 * getIntlLocale(); // "de-CH" for "de-CHZ"
 * ```
 */
function getIntlLocale(): string {
  const locale = getCurrentLanguage();

  // Map custom locale codes to valid Intl codes
  const localeMap: Record<string, string> = {
    'de-CHZ': 'de-CH', // Zürich dialect → Swiss German formatting
    'de-CHB': 'de-CH', // Bernese dialect → Swiss German formatting
    'zh-Hans': 'zh-CN', // Simplified Chinese
  };

  return localeMap[locale] || locale;
}

/**
 * Format distance in meters or kilometers.
 *
 * Shows meters for distances < 1km, kilometers with 1 decimal for larger distances.
 * Handles invalid values gracefully.
 *
 * @param meters - Distance in meters
 * @returns Formatted distance string (e.g., "500 m", "5.2 km")
 *
 * @example
 * ```ts
 * formatDistance(500);   // "500 m"
 * formatDistance(1500);  // "1.5 km"
 * formatDistance(NaN);   // "0 m"
 * ```
 */
export function formatDistance(meters: number): string {
  if (!Number.isFinite(meters) || meters < 0) {
    return '0 m';
  }
  if (meters < 1000) {
    return `${Math.round(meters)} m`;
  }
  const km = meters / 1000;
  return `${km.toFixed(1)} km`;
}

/**
 * Format duration in hours:minutes:seconds or minutes:seconds.
 *
 * Shows HH:MM:SS format for durations >= 1 hour, MM:SS for shorter durations.
 * Handles invalid values gracefully.
 *
 * @param seconds - Duration in seconds
 * @returns Formatted duration string (e.g., "1:23:45", "45:30")
 *
 * @example
 * ```ts
 * formatDuration(90);     // "1:30"
 * formatDuration(3665);   // "1:01:05"
 * formatDuration(NaN);    // "0:00"
 * ```
 */
export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return '0:00';
  }
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Format pace as minutes per kilometer.
 *
 * Shows running/cycling pace in MM:SS /km format.
 * Returns "--:--" for invalid or non-positive values.
 *
 * @param metersPerSecond - Speed in meters per second
 * @returns Formatted pace string (e.g., "5:30 /km", "--:--")
 *
 * @example
 * ```ts
 * formatPace(3.0);    // "5:33 /km" (≈ 10.8 km/h)
 * formatPace(0);      // "--:--"
 * ```
 */
export function formatPace(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond <= 0) return '--:--';
  const totalSeconds = Math.round(1000 / metersPerSecond);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')} /km`;
}

/**
 * Compact pace format for UI pills (no units).
 *
 * Same as formatPace but without the "/km" suffix for compact display.
 *
 * @param metersPerSecond - Speed in meters per second
 * @returns Formatted pace string (e.g., "5:30", "--:--")
 */
export function formatPaceCompact(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond <= 0) return '--:--';
  const totalSeconds = Math.round(1000 / metersPerSecond);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format swim pace in minutes per 100 meters.
 *
 * Swimming uses per-100m pace instead of per-km.
 *
 * @param metersPerSecond - Speed in meters per second
 * @returns Formatted swim pace string (e.g., "2:30", "--:--")
 */
export function formatSwimPace(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond <= 0) return '--:--';
  const totalSeconds = Math.round(100 / metersPerSecond);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/**
 * Format speed in kilometers per hour.
 *
 * Converts meters per second to km/h with 1 decimal precision.
 *
 * @param metersPerSecond - Speed in meters per second
 * @returns Formatted speed string (e.g., "25.5 km/h", "0.0 km/h")
 *
 * @example
 * ```ts
 * formatSpeed(10);    // "36.0 km/h"
 * formatSpeed(-1);    // "0.0 km/h"
 * ```
 */
export function formatSpeed(metersPerSecond: number): string {
  if (!Number.isFinite(metersPerSecond) || metersPerSecond < 0) {
    return '0.0 km/h';
  }
  const kmh = metersPerSecond * 3.6;
  return `${kmh.toFixed(1)} km/h`;
}

export function formatElevation(meters: number | undefined | null): string {
  if (meters == null || isNaN(meters)) return '0 m';
  return `${Math.round(meters)} m`;
}

export function formatHeartRate(bpm: number): string {
  if (!Number.isFinite(bpm) || bpm < 0) {
    return '0 bpm';
  }
  return `${Math.round(bpm)} bpm`;
}

export function formatPower(watts: number): string {
  if (!Number.isFinite(watts) || watts < 0) {
    return '0 W';
  }
  return `${Math.round(watts)} W`;
}

/**
 * Format date as relative time or localized date.
 *
 * Returns human-readable relative dates:
 * - "Today" for today
 * - "Yesterday" for yesterday
 * - Day of week (e.g., "Friday") for last 7 days
 * - Short date (e.g., "Jan 5") for earlier this year
 * - Full date (e.g., "Jan 5, 2023") for previous years
 *
 * Uses localized date formats based on app language setting.
 *
 * @param dateString - ISO date string to format
 * @returns Localized relative date string
 *
 * @example
 * ```ts
 * formatRelativeDate("2024-01-15"); // "Jan 15" (if same year)
 * formatRelativeDate("2023-06-15"); // "Jun 15, 2023" (if different year)
 * formatRelativeDate(today);        // "Today"
 * ```
 */
export function formatRelativeDate(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();

  // Compare calendar days, not elapsed time
  // This ensures "yesterday at 4pm" shows as "Yesterday" even if checked at 8am today
  const dateDay = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const nowDay = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((nowDay.getTime() - dateDay.getTime()) / (1000 * 60 * 60 * 24));

  const isCurrentYear = date.getFullYear() === now.getFullYear();
  const locale = getIntlLocale();

  if (diffDays === 0) {
    return i18n.t('time.today') || 'Today';
  } else if (diffDays === 1) {
    return i18n.t('time.yesterday') || 'Yesterday';
  } else if (diffDays < 7) {
    return date.toLocaleDateString(locale, { weekday: 'long' });
  } else if (isCurrentYear) {
    return date.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
    });
  } else {
    return date.toLocaleDateString(locale, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
  }
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString);
  const locale = getIntlLocale();
  return date.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Format date as short date (e.g., "Jan 2")
 */
export function formatShortDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = getIntlLocale();
  return d.toLocaleDateString(locale, { month: 'short', day: 'numeric' });
}

/**
 * Format date with weekday (e.g., "Fri, Jan 2")
 */
export function formatShortDateWithWeekday(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = getIntlLocale();
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format month only (e.g., "Jan")
 */
export function formatMonth(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = getIntlLocale();
  return d.toLocaleDateString(locale, { month: 'short' });
}

/**
 * Format date range (e.g., "Jan 2 - Jan 9")
 */
export function formatDateRange(start: Date | string, end: Date | string): string {
  return `${formatShortDate(start)} - ${formatShortDate(end)}`;
}

/**
 * Format full date with year (e.g., "Jan 2, 2024")
 */
export function formatFullDate(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = getIntlLocale();
  return d.toLocaleDateString(locale, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/**
 * Format full date with weekday and year (e.g., "Fri, Jan 2, 2024")
 */
export function formatFullDateWithWeekday(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  const locale = getIntlLocale();
  return d.toLocaleDateString(locale, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

export function formatTSS(load: number): string {
  return `${Math.round(load)}`;
}

export function formatCalories(kcal: number): string {
  if (!Number.isFinite(kcal) || kcal < 0) {
    return '0';
  }
  if (kcal >= 1000) {
    return `${(kcal / 1000).toFixed(1)}k`;
  }
  return `${Math.round(kcal)}`;
}

/**
 * Format a date as YYYY-MM-DD using local timezone (not UTC).
 * Use this instead of toISOString().split('T')[0] to avoid timezone issues.
 */
export function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Get today's date as YYYY-MM-DD in local timezone
 */
export function getTodayLocalDate(): string {
  return formatLocalDate(new Date());
}

/**
 * Clamp a value between min and max bounds
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
