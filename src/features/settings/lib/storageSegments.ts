/**
 * The storage bar's segments, ranked by size on the sequential ramp.
 *
 * Nothing in the bar is a sport or a measure, so no store has a hue of its own:
 * the largest takes the top step and each smaller one the step below. The ramp
 * has five steps, so the bar draws five segments at most, and when there are
 * more stores than that the four largest keep their own and the rest fold into
 * one "Other" on the bottom step.
 */

/** Every name the bar's key can print. A key, never a literal. */
export type StorageLabelKey =
  | 'settings.storageDatabase'
  | 'settings.storageHeatmap'
  | 'settings.storageVector'
  | 'settings.storageGround'
  | 'settings.storagePreviews'
  | 'settings.storageBackups'
  | 'settings.storageOther';

export interface StorageCategory {
  labelKey: Exclude<StorageLabelKey, 'settings.storageOther'>;
  bytes: number;
}

/** A step on the five-step sequential ramp, 5 the most. */
export type RampStep = 1 | 2 | 3 | 4 | 5;

export interface StorageSegment {
  labelKey: StorageLabelKey;
  bytes: number;
  step: RampStep;
}

const MAX_SEGMENTS = 5;

/** Largest first, an empty store dropped, a tie kept in the order given. */
export function storageSegments(categories: readonly StorageCategory[]): StorageSegment[] {
  const ranked = categories.filter((c) => c.bytes > 0).sort((a, b) => b.bytes - a.bytes);
  const kept: { labelKey: StorageLabelKey; bytes: number }[] =
    ranked.length > MAX_SEGMENTS ? ranked.slice(0, MAX_SEGMENTS - 1) : ranked;
  if (ranked.length > MAX_SEGMENTS) {
    const rest = ranked.slice(MAX_SEGMENTS - 1).reduce((sum, c) => sum + c.bytes, 0);
    kept.push({ labelKey: 'settings.storageOther', bytes: rest });
  }
  return kept.map((c, i) => ({ ...c, step: (MAX_SEGMENTS - i) as RampStep }));
}
