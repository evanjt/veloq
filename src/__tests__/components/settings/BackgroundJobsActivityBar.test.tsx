import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { BackgroundJobsActivityBar } from '@/features/settings/components/BackgroundJobsActivityBar';
import type { BackgroundJob } from '@/features/settings/hooks/useBackgroundJobs';
import { initializeI18n, changeLanguage } from '@/i18n';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

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
    lastRun: null,
    ...over,
  };
}

describe('BackgroundJobsActivityBar', () => {
  beforeAll(async () => {
    await initializeI18n('en-GB');
  });

  beforeEach(async () => {
    await changeLanguage('en-GB');
  });

  it('stays hidden when no job runs or owes work', () => {
    mockUseBackgroundJobs.mockReturnValue([job('detection'), job('streamBackfill')]);
    expect(
      render(<BackgroundJobsActivityBar />).queryByTestId('background-jobs-activity')
    ).toBeNull();
  });

  it('expands to show each running or owed job and its progress', () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('detection', { state: 'running', completed: 4, total: 12 }),
      job('elevationBackfill', { state: 'complete' }),
      job('cutover', { remaining: 1 }),
      job('streamBackfill', { remaining: 8 }),
    ]);
    const tree = render(<BackgroundJobsActivityBar />);

    expect(tree.getByTestId('background-jobs-activity')).toBeTruthy();
    expect(tree.queryByTestId('background-job-detection')).toBeNull();
    fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    expect(tree.getByTestId('background-job-detection-detail').props.children).toBe('4 of 12');
    expect(tree.getByTestId('background-job-cutover')).toBeTruthy();
    expect(tree.getByTestId('background-job-streamBackfill')).toBeTruthy();
    expect(tree.queryByTestId('background-job-elevationBackfill')).toBeNull();
  });

  it('clears a finished job when the polled state has no work left', () => {
    mockUseBackgroundJobs.mockReturnValue([job('detection', { state: 'running' })]);
    const tree = render(<BackgroundJobsActivityBar />);
    expect(tree.getByTestId('background-jobs-activity')).toBeTruthy();

    mockUseBackgroundJobs.mockReturnValue([job('detection', { state: 'complete' })]);
    tree.rerender(<BackgroundJobsActivityBar />);
    expect(tree.queryByTestId('background-jobs-activity')).toBeNull();
  });
});
