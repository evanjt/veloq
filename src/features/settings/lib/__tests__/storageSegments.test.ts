/**
 * The storage bar has no hue identity: nothing in it is a sport or a measure,
 * so its segments are ranked by size on the sequential ramp, at most five of
 * them, the smallest folded into one "Other".
 */

import { storageSegments, type StorageCategory } from '../storageSegments';

const category = (labelKey: string, bytes: number) => ({ labelKey, bytes }) as StorageCategory;

describe('storageSegments', () => {
  it('folds a sixth category into Other and ramps the four largest down from the top step', () => {
    const segments = storageSegments([
      category('settings.storageDatabase', 1_000),
      category('settings.storageHeatmap', 6_000),
      category('settings.storageVector', 3_000),
      category('settings.storageGround', 5_000),
      category('settings.storagePreviews', 2_000),
      category('settings.storageBackups', 4_000),
    ]);
    expect(segments).toEqual([
      { labelKey: 'settings.storageHeatmap', bytes: 6_000, step: 5 },
      { labelKey: 'settings.storageGround', bytes: 5_000, step: 4 },
      { labelKey: 'settings.storageBackups', bytes: 4_000, step: 3 },
      { labelKey: 'settings.storageVector', bytes: 3_000, step: 2 },
      { labelKey: 'settings.storageOther', bytes: 3_000, step: 1 },
    ]);
  });

  it('keeps four categories as four segments on the top four steps', () => {
    const segments = storageSegments([
      category('settings.storageDatabase', 10),
      category('settings.storageHeatmap', 40),
      category('settings.storageVector', 30),
      category('settings.storageGround', 20),
    ]);
    expect(segments.map((s) => [s.labelKey, s.step])).toEqual([
      ['settings.storageHeatmap', 5],
      ['settings.storageVector', 4],
      ['settings.storageGround', 3],
      ['settings.storageDatabase', 2],
    ]);
  });

  it('draws exactly five categories without an Other', () => {
    const segments = storageSegments([
      category('settings.storageDatabase', 5),
      category('settings.storageHeatmap', 4),
      category('settings.storageVector', 3),
      category('settings.storageGround', 2),
      category('settings.storagePreviews', 1),
    ]);
    expect(segments.map((s) => s.step)).toEqual([5, 4, 3, 2, 1]);
    expect(segments.map((s) => s.labelKey)).not.toContain('settings.storageOther');
  });

  it('drops an empty store, so it neither takes a step nor counts towards the fold', () => {
    const segments = storageSegments([
      category('settings.storageDatabase', 0),
      category('settings.storageHeatmap', 9),
      category('settings.storageVector', 8),
      category('settings.storageGround', 7),
      category('settings.storagePreviews', 6),
      category('settings.storageBackups', 5),
    ]);
    expect(segments.map((s) => s.labelKey)).toEqual([
      'settings.storageHeatmap',
      'settings.storageVector',
      'settings.storageGround',
      'settings.storagePreviews',
      'settings.storageBackups',
    ]);
  });

  it('keeps the order the stores were given when two are the same size', () => {
    const segments = storageSegments([
      category('settings.storageDatabase', 7),
      category('settings.storageHeatmap', 7),
    ]);
    expect(segments.map((s) => s.labelKey)).toEqual([
      'settings.storageDatabase',
      'settings.storageHeatmap',
    ]);
  });

  it('returns nothing when every store is empty', () => {
    expect(storageSegments([])).toEqual([]);
    expect(storageSegments([category('settings.storageDatabase', 0)])).toEqual([]);
  });
});
