/**
 * FFI Conversion Utilities
 *
 * Shared utility functions for converting data types between FFI (Rust) and TypeScript.
 * These eliminate duplicate conversion logic scattered across hooks.
 */

import type { DirectionStats } from '@/types';

/**
 * Convert Unix timestamp (seconds since epoch) to JavaScript Date.
 * Handles both number and bigint (FFI returns i64 as bigint).
 * Returns null if timestamp is null/undefined/0.
 */
export function fromUnixSeconds(seconds: number | bigint | null | undefined): Date | null {
  if (!seconds) return null;
  // Convert bigint to number if needed (safe for timestamps until year 275760)
  const numSeconds = typeof seconds === 'bigint' ? Number(seconds) : seconds;
  return new Date(numSeconds * 1000);
}

/**
 * Convert FFI DirectionStats to TypeScript DirectionStats.
 * Handles the Unix timestamp to JS Date conversion for lastActivity.
 * FFI returns i64 timestamps as bigint.
 */
export function toDirectionStats(
  ffi:
    | { avgTime?: number | null; lastActivity?: number | bigint | null; count: number }
    | null
    | undefined
): DirectionStats | null {
  if (!ffi) return null;
  return {
    avgTime: ffi.avgTime ?? null,
    lastActivity: fromUnixSeconds(ffi.lastActivity),
    count: ffi.count,
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
 * Convert activity portions with direction casting.
 * Used when converting native section data to app section format.
 */
export function convertActivityPortions<T extends { direction: string }>(
  portions: T[] | null | undefined
): Array<Omit<T, 'direction'> & { direction: 'same' | 'reverse' }> | undefined {
  return portions?.map((p) => ({
    ...p,
    direction: castDirection(p.direction),
  }));
}
