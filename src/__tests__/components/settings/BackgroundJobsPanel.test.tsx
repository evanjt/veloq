/**
 * Scenario: the jobs screen replaces four surfaces that each vanished the
 * moment their job settled.
 *
 * Expected behaviour: every job keeps a row whatever its state, an idle backfill
 * says how much work is waiting, and only a running job shows a spinner. The
 * copy comes from the real catalogue, so the sentences are the shipped ones.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n, changeLanguage } from '@/i18n';
import { BackgroundJobsPanel } from '@/features/settings/components/BackgroundJobsPanel';
import type { BackgroundJob } from '@/features/settings/hooks/useBackgroundJobs';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const mockUseBackgroundJobs = jest.fn();
jest.mock('@/features/settings/hooks/useBackgroundJobs', () => ({
  useBackgroundJobs: () => mockUseBackgroundJobs(),
}));

function job(id: BackgroundJob['id'], over: Partial<BackgroundJob> = {}): BackgroundJob {
  return {
    id,
    state: 'idle',
    completed: 0,
    total: 0,
    percent: null,
    remaining: null,
    phase: null,
    ...over,
  };
}

const RESTING: BackgroundJob[] = [
  job('sync'),
  job('detection'),
  job('elevationBackfill'),
  job('cutover'),
];

function panel(jobs: BackgroundJob[] = RESTING) {
  mockUseBackgroundJobs.mockReturnValue(jobs);
  return render(<BackgroundJobsPanel />);
}

function detail(tree: ReturnType<typeof render>, id: string): string {
  return tree.getByTestId(`background-job-${id}-detail`).props.children as string;
}

describe('BackgroundJobsPanel', () => {
  beforeAll(async () => {
    await initializeI18n('en-GB');
  });

  beforeEach(async () => {
    jest.clearAllMocks();
    await changeLanguage('en-GB');
  });

  it('renders a row for every job when none of them is running', () => {
    const tree = panel();

    for (const id of ['sync', 'detection', 'elevationBackfill', 'cutover']) {
      expect(tree.getByTestId(`background-job-${id}`)).toBeTruthy();
      expect(detail(tree, id)).toBe('Not running');
    }
  });

  it('spins only for the job that is running', () => {
    const tree = panel([
      job('sync', { state: 'running', completed: 4, total: 12 }),
      job('detection'),
      job('elevationBackfill'),
      job('cutover'),
    ]);

    expect(tree.getByTestId('background-job-sync-spinner')).toBeTruthy();
    expect(tree.queryByTestId('background-job-detection-spinner')).toBeNull();
    expect(detail(tree, 'sync')).toBe('4 of 12');
  });

  it('says what a resting backfill still has to fetch', () => {
    const tree = panel([
      job('sync'),
      job('detection'),
      job('elevationBackfill', { remaining: 37 }),
      job('cutover'),
    ]);

    expect(detail(tree, 'elevationBackfill')).toBe('37 still to fetch');
  });

  /**
   * The resting count is one string shared by every job, and it was written for
   * the download. A rebuild fetches nothing, so a cutover resting on it read
   * "1 still to fetch".
   */
  it('says a resting cutover is waiting to rebuild, not waiting to fetch', () => {
    const tree = panel([
      job('sync'),
      job('detection'),
      job('elevationBackfill'),
      job('cutover', { remaining: 1 }),
    ]);

    expect(detail(tree, 'cutover')).toBe('Waiting to rebuild your sections');
  });

  it('counts what a resting detection has never seen, in its own words', () => {
    const tree = panel([
      job('sync'),
      job('detection', { remaining: 12 }),
      job('elevationBackfill'),
      job('cutover'),
    ]);

    expect(detail(tree, 'detection')).toBe('12 activities to check');
  });

  it('reads as not running when detection owes nothing', () => {
    const tree = panel([
      job('sync'),
      job('detection', { remaining: 0 }),
      job('elevationBackfill'),
      job('cutover'),
    ]);

    expect(detail(tree, 'detection')).toBe('Not running');
  });

  it('reads as not running when the cutover token is clear', () => {
    const tree = panel([
      job('sync'),
      job('detection'),
      job('elevationBackfill'),
      job('cutover', { remaining: 0 }),
    ]);

    expect(detail(tree, 'cutover')).toBe('Not running');
  });

  it('reads as not running when the queue length is unknown', () => {
    const tree = panel([
      job('sync'),
      job('detection'),
      job('elevationBackfill', { remaining: null }),
      job('cutover'),
    ]);

    expect(detail(tree, 'elevationBackfill')).toBe('Not running');
  });

  it('does not offer a count for an empty queue', () => {
    const tree = panel([
      job('sync'),
      job('detection'),
      job('elevationBackfill', { remaining: 0 }),
      job('cutover'),
    ]);

    expect(detail(tree, 'elevationBackfill')).toBe('Not running');
  });

  it('keeps a partial backfill distinct from a finished one', () => {
    const tree = panel([
      job('sync'),
      job('detection'),
      job('elevationBackfill', { state: 'partial' }),
      job('cutover', { state: 'complete' }),
    ]);

    expect(detail(tree, 'elevationBackfill')).toBe('Finished, some to retry');
    expect(detail(tree, 'cutover')).toBe('Finished');
  });

  it('names the phase a detection run is in, with its percent', () => {
    const tree = panel([
      job('sync'),
      job('detection', { state: 'running', phase: 'clustering', percent: 62 }),
      job('elevationBackfill'),
      job('cutover'),
    ]);

    expect(detail(tree, 'detection')).toBe('Clustering sections · 62%');
  });

  it('falls back to a plain running line when the job counts nothing', () => {
    const tree = panel([
      job('sync', { state: 'running' }),
      job('detection'),
      job('elevationBackfill'),
      job('cutover'),
    ]);

    expect(detail(tree, 'sync')).toBe('Running');
  });

  it('reads a stopped job differently from an idle one', () => {
    const tree = panel([
      job('sync', { state: 'failed' }),
      job('detection'),
      job('elevationBackfill'),
      job('cutover'),
    ]);

    expect(detail(tree, 'sync')).toBe('Stopped early');
  });
});
