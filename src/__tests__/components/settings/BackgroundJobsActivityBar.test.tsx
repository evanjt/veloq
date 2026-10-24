import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { BackgroundJobsActivityBar } from '@/features/settings/components/BackgroundJobsActivityBar';
import type { BackgroundJob } from '@/features/settings/hooks/useBackgroundJobs';
import { initialiseI18n, changeLanguage } from '@/i18n';
import { formatClockOrDate } from '@/shared/format/format';

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
    resumesAt: null,
    pacedDays: null,
    lastRun: null,
    ...over,
  };
}

describe('BackgroundJobsActivityBar', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  beforeEach(async () => {
    await changeLanguage('en-GB');
  });

  it('stays hidden when no job runs or owes work', async () => {
    mockUseBackgroundJobs.mockReturnValue([job('detection'), job('streamBackfill')]);
    expect(
      await (await render(<BackgroundJobsActivityBar />)).queryByTestId('background-jobs-activity')
    ).toBeNull();
  });

  it('expands to show each running or owed job and its progress', async () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('detection', { state: 'running', completed: 4, total: 12 }),
      job('elevationBackfill', { state: 'complete' }),
      job('cutover', { remaining: 1 }),
      job('streamBackfill', { remaining: 8 }),
    ]);
    const tree = await render(<BackgroundJobsActivityBar />);

    expect(tree.getByTestId('background-jobs-activity')).toBeTruthy();
    expect(tree.queryByTestId('background-job-detection')).toBeNull();
    await fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    expect(tree.getByTestId('background-job-detection-detail').props.children).toBe('4 of 12');
    expect(tree.getByTestId('background-job-cutover')).toBeTruthy();
    expect(tree.getByTestId('background-job-streamBackfill')).toBeTruthy();
    expect(tree.queryByTestId('background-job-elevationBackfill')).toBeNull();
  });

  it('clears a finished job when the polled state has no work left', async () => {
    mockUseBackgroundJobs.mockReturnValue([job('detection', { state: 'running' })]);
    const tree = await render(<BackgroundJobsActivityBar />);
    expect(tree.getByTestId('background-jobs-activity')).toBeTruthy();

    mockUseBackgroundJobs.mockReturnValue([job('detection', { state: 'complete' })]);
    await tree.rerender(<BackgroundJobsActivityBar />);
    expect(tree.queryByTestId('background-jobs-activity')).toBeNull();
  });

  it('shows translated cutover and detection phases in the active locale', async () => {
    await changeLanguage('de-DE');
    mockUseBackgroundJobs.mockReturnValue([
      job('cutover', { state: 'running', phase: 'draining' }),
      job('detection', { state: 'running', phase: 'analyzing', percent: 40 }),
    ]);
    const tree = await render(<BackgroundJobsActivityBar />);

    await fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    expect(tree.getByTestId('background-job-cutover-detail').props.children).toBe(
      'Katalog vorbereiten'
    );
    expect(tree.getByTestId('background-job-detection-detail')).toHaveTextContent(
      'Aktivitäten analysieren · 40 %'
    );
  });

  it('shows an unknown engine phase without a translation', async () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('cutover', { state: 'running', phase: 'new_phase' }),
    ]);
    const tree = await render(<BackgroundJobsActivityBar />);

    await fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    expect(tree.getByTestId('background-job-cutover-detail').props.children).toBe('new_phase');
  });

  /**
   * Scenario: the library owes more activities than the daily allowance draws in
   * one day, so the download is paced on intervals.icu's caps and takes days.
   *
   * Expected behaviour: the resting row names the pacing beside its count and
   * the days it takes, so the athlete is not left to read a slow count as a
   * stuck app.
   */
  it('says a resting download is paced on intervals.icu caps, with the days it takes', async () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('streamBackfill', { remaining: 1400, pacedDays: 3 }),
    ]);
    const tree = await render(<BackgroundJobsActivityBar />);

    await fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    expect(tree.getByTestId('background-job-streamBackfill-detail').props.children).toBe(
      "1400 activities · Paced on intervals.icu's caps, about 3 days to finish"
    );
  });

  it('names no pacing for a queue the engine did not price in days', async () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('streamBackfill', { remaining: 40, pacedDays: null }),
    ]);
    const tree = await render(<BackgroundJobsActivityBar />);

    await fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    expect(tree.getByTestId('background-job-streamBackfill-detail').props.children).toBe(
      '40 activities'
    );
  });

  /**
   * Scenario: the request budget holds the stream download with 1,200
   * activities owed, and the engine says when it resumes. The pass that
   * stopped recorded its run as deferred.
   *
   * Expected behaviour: the row counts what is owed and says when it resumes,
   * and neither line reads as a finished run with some to retry.
   */
  it('shows what a waiting download owes and when it resumes', async () => {
    const resumesAt = Date.now() + 15 * 60_000;
    mockUseBackgroundJobs.mockReturnValue([
      job('streamBackfill', {
        state: 'waiting',
        remaining: 1200,
        resumesAt,
        lastRun: {
          finishedAt: Date.now() - 60_000,
          outcome: 'deferred',
          handled: 1240,
          added: 0,
          changed: 40,
          retired: 0,
          failed: 0,
        },
      }),
    ]);
    const tree = await render(<BackgroundJobsActivityBar />);

    await fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    const detail = tree.getByTestId('background-job-streamBackfill-detail');
    expect(detail).toHaveTextContent(`1200 activities · Resumes ${formatClockOrDate(resumesAt)}`);
    expect(tree.queryByText(/some to retry/)).toBeNull();
    expect(tree.getByTestId('background-job-streamBackfill-last-run')).toHaveTextContent(
      /Waiting to resume/
    );
  });

  it('says a waiting download is waiting when it has no count or time to show', async () => {
    mockUseBackgroundJobs.mockReturnValue([
      job('elevationBackfill', { state: 'waiting', remaining: null, resumesAt: null }),
    ]);
    const tree = await render(<BackgroundJobsActivityBar />);

    await fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    expect(tree.getByTestId('background-job-elevationBackfill-detail').props.children).toBe(
      'Waiting to resume'
    );
  });

  it('says when a waiting download resumes in every locale', async () => {
    await changeLanguage('de-DE');
    const resumesAt = Date.now() + 15 * 60_000;
    mockUseBackgroundJobs.mockReturnValue([
      job('elevationBackfill', { state: 'waiting', remaining: 2500, resumesAt }),
    ]);
    const tree = await render(<BackgroundJobsActivityBar />);

    await fireEvent.press(tree.getByTestId('background-jobs-activity-toggle'));
    const detail = tree.getByTestId('background-job-elevationBackfill-detail');
    expect(detail).toHaveTextContent(new RegExp(formatClockOrDate(resumesAt)));
    expect(detail).not.toHaveTextContent(/Resumes/);
  });
});
