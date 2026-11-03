/**
 * Scenario: the athlete is on Settings while a background job runs, or after
 * one stopped early.
 *
 * Expected behaviour: the title bar's jobs icon shows the state without
 * opening anything, names it in full for a screen reader, and opens the jobs
 * screen.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { BackgroundJobsHeaderItem } from '@/features/settings/components/BackgroundJobsHeaderItem';
import type { BackgroundJob } from '@/features/settings/hooks/useBackgroundJobs';
import { initialiseI18n, changeLanguage } from '@/i18n';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

const mockNavigateTo = jest.fn();
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: (...args: unknown[]) => mockNavigateTo(...args),
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
    remaining: 0,
    phase: null,
    resumesAt: null,
    held: null,
    pacedDays: null,
    stagedHistory: null,
    lastRun: null,
    ...over,
  };
}

describe('BackgroundJobsHeaderItem', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  beforeEach(async () => {
    await changeLanguage('en-GB');
    mockNavigateTo.mockReset();
  });

  it('shows a spinner and the running count, and opens the jobs screen', async () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('detection', { state: 'running' }),
      job('cutover', { state: 'running' }),
    ]);
    const tree = await render(<BackgroundJobsHeaderItem />);

    expect(tree.getByTestId('background-jobs-header-spinner')).toBeTruthy();
    expect(tree.getByTestId('background-jobs-header-count')).toHaveTextContent('2');
    const item = tree.getByTestId('background-jobs-header-item');
    expect(item.props.accessibilityLabel).toBe('2 background jobs running');

    await fireEvent.press(item);
    expect(mockNavigateTo).toHaveBeenCalledWith('/background-jobs');
  });

  it('says one job in the singular', async () => {
    mockUseBackgroundJobs.mockReturnValue([job('detection', { state: 'running' })]);
    const tree = await render(<BackgroundJobsHeaderItem />);
    expect(tree.getByTestId('background-jobs-header-item').props.accessibilityLabel).toBe(
      '1 background job running'
    );
  });

  it('marks a job that stopped early with the error state', async () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('detection', {
        lastRun: {
          finishedAt: 1,
          outcome: 'failed',
          handled: 1,
          added: 0,
          changed: 0,
          retired: 0,
          failed: 1,
        },
      }),
    ]);
    const tree = await render(<BackgroundJobsHeaderItem />);
    expect(tree.getByTestId('background-jobs-header-failed')).toBeTruthy();
    expect(tree.queryByTestId('background-jobs-header-spinner')).toBeNull();
    expect(tree.getByTestId('background-jobs-header-item').props.accessibilityLabel).toBe(
      '1 background job stopped early'
    );
  });

  it('marks waiting jobs, and shows the plain icon when all are done', async () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('streamBackfill', { state: 'waiting', remaining: 4 }),
    ]);
    const tree = await render(<BackgroundJobsHeaderItem />);
    expect(tree.getByTestId('background-jobs-header-waiting')).toBeTruthy();

    mockUseBackgroundJobs.mockReturnValue([job('detection')]);
    await tree.rerender(<BackgroundJobsHeaderItem />);
    expect(tree.queryByTestId('background-jobs-header-waiting')).toBeNull();
    expect(tree.queryByTestId('background-jobs-header-count')).toBeNull();
    expect(tree.getByTestId('background-jobs-header-item').props.accessibilityLabel).toBe(
      'All background jobs done'
    );
  });
});
