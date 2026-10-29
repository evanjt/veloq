/**
 * FFI Conversion Utilities
 *
 * Shared utility functions for converting data types between FFI (Rust) and TypeScript.
 * These eliminate duplicate conversion logic scattered across hooks.
 */

import { FfiOffScale } from 'veloqrs';
import { wallClockSecondsToLocalDate } from '@/shared/time/startDate';
import type { DirectionStats } from '@/types';

/**
 * Guard a raw FFI number against NaN/Infinity.
 * Rust f32/f64 can serialise non-finite values (e.g. 0/0 pace) that would
 * render as 'NaN'/'Infinity' in the UI. Returns `fallback` for anything
 * not finite, including null/undefined.
 */
export function ensureFinite(value: number | null | undefined, fallback = 0): number {
  return Number.isFinite(value) ? (value as number) : fallback;
}

/**
 * An engine activity date, the athlete's wall clock stamped as UTC, as the local `Date` every
 * formatter reads, so a day renders as the day it was ridden in any zone. Null when absent.
 */
export function fromWallClockSeconds(seconds: number | null | undefined): Date | null {
  if (seconds == null) return null;
  return wallClockSecondsToLocalDate(seconds);
}

/**
 * Convert FFI DirectionStats to TypeScript DirectionStats.
 * Handles the Unix timestamp to JS Date conversion for lastActivity.
 */
export function toDirectionStats(
  ffi:
    | {
        avgTime?: number | null;
        lastActivity?: number | null;
        count: number;
        avgSpeed?: number | null;
        outsideBandCount?: number;
      }
    | null
    | undefined
): DirectionStats | null {
  if (!ffi) return null;
  return {
    avgTime: ffi.avgTime ?? null,
    lastActivity: fromWallClockSeconds(ffi.lastActivity),
    count: ffi.count,
    avgSpeed: ffi.avgSpeed ?? null,
    outsideBandCount: ffi.outsideBandCount ?? 0,
  };
}

/**
 * Cast a direction string to the union type 'same' | 'reverse'.
 * Defaults to 'same' for any non-'reverse' value.
 */
export function castDirection(direction: string | null | undefined): 'same' | 'reverse' {
  return direction === 'reverse' ? 'reverse' : 'same';
}

/**
 * A lap's direction. A pass that crosses no gate has no time and arrives as
 * "partial", which is kept apart from the two directions.
 */
export function castLapDirection(
  direction: string | null | undefined
): 'same' | 'reverse' | 'partial' {
  return direction === 'partial' ? 'partial' : castDirection(direction);
}

/** The side of its focus range the engine found a scatter point past, absent when inside. */
export function castOffScale(offScale: FfiOffScale | undefined): 'slow' | 'fast' | undefined {
  if (offScale === FfiOffScale.Slow) return 'slow';
  if (offScale === FfiOffScale.Fast) return 'fast';
  return undefined;
}

/**
 * Convert activity portions with direction casting.
 * Used when converting native section data to app section format.
 */
export function convertActivityPortions<T extends { direction: string }>(
  portions: T[] | null | undefined
): (Omit<T, 'direction'> & { direction: 'same' | 'reverse' })[] | undefined {
  return portions?.map((p) => ({
    ...p,
    direction: castDirection(p.direction),
  }));
}
