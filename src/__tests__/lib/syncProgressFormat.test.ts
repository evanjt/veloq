/**
 * Tests for sync progress formatting utilities.
 *
 * Covers: formatGpsSyncProgress
 */

import type { GpsSyncProgress } from '@/shared/app/SyncDateRangeStore';
import { formatGpsSyncProgress } from '@/features/maps/lib/syncProgressFormat';
import { tilePassProgress } from '@/features/routes/lib/tilePass';
import { i18n, initialiseI18n } from '@/i18n';

import type { TFunction } from 'i18next';
const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

describe('formatGpsSyncProgress', () => {
  const idle: GpsSyncProgress = {
    status: 'idle',
    completed: 0,
    total: 0,
    percent: 0,
    message: '',
  };

  it('returns loading indicator when fetching activities and idle', () => {
    const result = formatGpsSyncProgress(idle, true, t);
    expect(result).not.toBeNull();
    expect(result!.indeterminate).toBe(true);
    expect(result!.icon).toBe('cloud-download-outline');
    expect(result!.text).toBe('mapScreen.loadingActivities');
  });

  it('returns null when idle and not fetching activities', () => {
    expect(formatGpsSyncProgress(idle, false, t)).toBeNull();
  });

  it('shows GPS download progress when status is fetching', () => {
    const fetching: GpsSyncProgress = {
      status: 'fetching',
      completed: 5,
      total: 10,
      percent: 50,
      message: '',
    };
    const result = formatGpsSyncProgress(fetching, false, t);
    expect(result).not.toBeNull();
    expect(result!.icon).toBe('download-outline');
    expect(result!.percent).toBe(50);
    expect(result!.countText).toBe('5/10');
    expect(result!.indeterminate).toBe(false);
  });

  it('shows indeterminate when fetching with 0/0', () => {
    const fetching: GpsSyncProgress = {
      status: 'fetching',
      completed: 0,
      total: 0,
      percent: 0,
      message: '',
    };
    const result = formatGpsSyncProgress(fetching, false, t);
    expect(result!.indeterminate).toBe(true);
    expect(result!.countText).toBeNull();
  });

  it('shows route analysis for computing status', () => {
    const computing: GpsSyncProgress = {
      status: 'computing',
      completed: 0,
      total: 0,
      percent: 30,
      message: '',
    };
    const result = formatGpsSyncProgress(computing, false, t);
    expect(result).not.toBeNull();
    expect(result!.icon).toBe('map-marker-path');
    expect(result!.percent).toBe(30);
  });

  it('returns null for complete status when not fetching', () => {
    const complete: GpsSyncProgress = {
      status: 'complete',
      completed: 10,
      total: 10,
      percent: 100,
      message: '',
    };
    expect(formatGpsSyncProgress(complete, false, t)).toBeNull();
  });

  it('returns loading indicator when fetching activities after previous sync completed', () => {
    const complete: GpsSyncProgress = {
      status: 'complete',
      completed: 10,
      total: 10,
      percent: 100,
      message: '',
    };
    const result = formatGpsSyncProgress(complete, true, t);
    expect(result).not.toBeNull();
    expect(result!.indeterminate).toBe(true);
    expect(result!.icon).toBe('cloud-download-outline');
    expect(result!.text).toBe('mapScreen.loadingActivities');
  });

  it('calls correct i18n keys', () => {
    const fetching: GpsSyncProgress = {
      status: 'fetching',
      completed: 1,
      total: 5,
      percent: 20,
      message: '',
    };
    const result = formatGpsSyncProgress(fetching, false, t);
    expect(result!.text).toBe(
      'cache.stageProgress:{"stage":"routesScreen.downloadingGps","percent":20}'
    );
  });
});

/**
 * Scenario: the heatmap tile pass is 40 % through while the sync as a whole
 * stands at 85 %, and the banner prints its line in the athlete's language.
 *
 * Expected behaviour: the line carries one figure, the overall one, and one
 * typographic ellipsis. The stage message used to bring its own tile figure, so
 * the banner read "Finalising heatmap... 40%... 85%".
 */
describe('the banner line in real copy', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  const percentSigns = (line: string) => line.split('%').length - 1;

  it('prints one percentage for the heatmap stage, the overall one', () => {
    const progress: GpsSyncProgress = {
      status: 'computing',
      completed: 0,
      total: 0,
      percent: 85,
      message: i18n.t('cache.finalizingHeatmap', { percent: 40 }),
    };
    const line = formatGpsSyncProgress(progress, false, i18n.t)!.text;
    expect(percentSigns(line)).toBe(1);
    expect(line).toContain('85%');
    expect(line).not.toContain('40%');
    expect(line).not.toContain('...');
  });

  it('builds the tile pass row with the overall figure and a stage message without one', () => {
    const row = tilePassProgress(40, 100, i18n.t);
    expect(row).toMatchObject({ status: 'computing', percent: 85 });
    expect(row.message).not.toMatch(/\d/);
    const line = formatGpsSyncProgress(row, false, i18n.t)!.text;
    expect(percentSigns(line)).toBe(1);
    expect(line).toContain('85%');
  });

  it('starts the tile range at its floor and ends it at its ceiling', () => {
    expect(tilePassProgress(0, 100, i18n.t).percent).toBe(75);
    expect(tilePassProgress(100, 100, i18n.t).percent).toBe(100);
    expect(tilePassProgress(250, 100, i18n.t).percent).toBe(100);
    expect(tilePassProgress(50, 100, i18n.t, 50, 100).percent).toBe(75);
  });

  it('prints the stage alone, with no figure, before any progress', () => {
    const progress: GpsSyncProgress = {
      status: 'computing',
      completed: 0,
      total: 0,
      percent: 0,
      message: '',
    };
    const line = formatGpsSyncProgress(progress, false, i18n.t)!.text;
    expect(percentSigns(line)).toBe(0);
    expect(line).toBe(i18n.t('cache.analyzingRoutes'));
  });

  it('prints the download figure once', () => {
    const progress: GpsSyncProgress = {
      status: 'fetching',
      completed: 5,
      total: 10,
      percent: 25,
      message: i18n.t('cache.downloadingGpsProgress', { percent: 25 }),
    };
    const line = formatGpsSyncProgress(progress, false, i18n.t)!.text;
    expect(percentSigns(line)).toBe(1);
    expect(line).toContain('25%');
  });
});
