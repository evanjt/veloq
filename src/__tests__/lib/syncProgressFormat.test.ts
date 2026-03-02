/**
 * Tests for sync progress formatting utilities.
 *
 * Covers: formatGpsSyncProgress, formatBoundsSyncProgress
 * Bug fix validated: completed > total produces >100%
 */

import type { GpsSyncProgress } from '@/providers/SyncDateRangeStore';
import { formatGpsSyncProgress, formatBoundsSyncProgress } from '@/lib/utils/syncProgressFormat';

const t = (key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key;

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

  it('shows route analysis for processing status', () => {
    const processing: GpsSyncProgress = {
      status: 'processing',
      completed: 0,
      total: 0,
      percent: 60,
      message: '',
    };
    const result = formatGpsSyncProgress(processing, false, t);
    expect(result).not.toBeNull();
    expect(result!.icon).toBe('map-marker-path');
  });

  it('shows indeterminate when computing with 0 percent', () => {
    const computing: GpsSyncProgress = {
      status: 'computing',
      completed: 0,
      total: 0,
      percent: 0,
      message: '',
    };
    const result = formatGpsSyncProgress(computing, false, t);
    expect(result!.indeterminate).toBe(true);
  });

  it('returns null for complete status', () => {
    const complete: GpsSyncProgress = {
      status: 'complete',
      completed: 10,
      total: 10,
      percent: 100,
      message: '',
    };
    expect(formatGpsSyncProgress(complete, false, t)).toBeNull();
  });

  it('returns null for error status', () => {
    const error: GpsSyncProgress = {
      status: 'error',
      completed: 5,
      total: 10,
      percent: 50,
      message: 'Failed',
    };
    expect(formatGpsSyncProgress(error, false, t)).toBeNull();
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
    expect(result!.text).toBe('routesScreen.downloadingGps');
  });
});

describe('formatBoundsSyncProgress', () => {
  it('returns null when status is not syncing', () => {
    expect(formatBoundsSyncProgress({ status: 'idle', completed: 0, total: 0 }, t)).toBeNull();
    expect(
      formatBoundsSyncProgress({ status: 'complete', completed: 10, total: 10 }, t)
    ).toBeNull();
  });

  it('shows sync progress when syncing', () => {
    const result = formatBoundsSyncProgress({ status: 'syncing', completed: 50, total: 100 }, t);
    expect(result).not.toBeNull();
    expect(result!.icon).toBe('cloud-sync-outline');
    expect(result!.percent).toBe(50);
    expect(result!.countText).toBe('50/100');
    expect(result!.indeterminate).toBe(false);
  });

  it('shows 0% when total is 0', () => {
    const result = formatBoundsSyncProgress({ status: 'syncing', completed: 0, total: 0 }, t);
    expect(result!.percent).toBe(0);
    expect(result!.countText).toBeNull();
  });

  it('clamps to 100% when completed > total (BUG FIX)', () => {
    const result = formatBoundsSyncProgress({ status: 'syncing', completed: 150, total: 100 }, t);
    expect(result!.percent).toBe(100);
  });

  it('correctly rounds percentage', () => {
    const result = formatBoundsSyncProgress({ status: 'syncing', completed: 1, total: 3 }, t);
    expect(result!.percent).toBe(33);
  });

  it('calls correct i18n key', () => {
    const result = formatBoundsSyncProgress({ status: 'syncing', completed: 1, total: 10 }, t);
    expect(result!.text).toBe('cache.syncingActivities');
  });
});
