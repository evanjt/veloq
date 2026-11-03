import { summariseBackgroundJobs } from '@/features/settings/lib/backgroundJobsSummary';
import type { BackgroundJob } from '@/features/settings/hooks/useBackgroundJobs';

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

const failedRun = {
  finishedAt: 1,
  outcome: 'failed',
  handled: 3,
  added: 0,
  changed: 0,
  retired: 0,
  failed: 3,
};

describe('summariseBackgroundJobs', () => {
  it('is idle with no jobs and with only resting ones', () => {
    expect(summariseBackgroundJobs([])).toEqual({ kind: 'idle', count: 0 });
    expect(
      summariseBackgroundJobs([job('detection'), job('streamBackfill', { state: 'complete' })])
    ).toEqual({ kind: 'idle', count: 0 });
  });

  it('counts the running jobs', () => {
    expect(
      summariseBackgroundJobs([
        job('detection', { state: 'running' }),
        job('cutover', { state: 'running' }),
        job('streamBackfill'),
      ])
    ).toEqual({ kind: 'running', count: 2 });
  });

  it('reports a job whose last run stopped early, or that failed now', () => {
    expect(
      summariseBackgroundJobs([job('detection', { lastRun: failedRun }), job('cutover')])
    ).toEqual({ kind: 'failed', count: 1 });
    expect(
      summariseBackgroundJobs([job('detection', { lastRun: { ...failedRun, outcome: 'stopped' } })])
    ).toEqual({ kind: 'failed', count: 1 });
    expect(summariseBackgroundJobs([job('detection', { state: 'failed' })])).toEqual({
      kind: 'failed',
      count: 1,
    });
  });

  it('does not call a finished run with some to retry a failure', () => {
    expect(
      summariseBackgroundJobs([
        job('elevationBackfill', { lastRun: { ...failedRun, outcome: 'partial' } }),
      ])
    ).toEqual({ kind: 'idle', count: 0 });
  });

  it('reports the earliest resume time of the waiting jobs', () => {
    expect(
      summariseBackgroundJobs([
        job('elevationBackfill', { state: 'waiting', resumesAt: 9000 }),
        job('streamBackfill', { state: 'waiting', held: { until: 5000, byUpstream: false } }),
      ])
    ).toEqual({ kind: 'waiting', count: 2, until: 5000 });
    expect(summariseBackgroundJobs([job('streamBackfill', { state: 'waiting' })])).toEqual({
      kind: 'waiting',
      count: 1,
      until: null,
    });
  });

  it('ranks running above failed above waiting above idle', () => {
    const failed = job('detection', { lastRun: failedRun });
    const waiting = job('streamBackfill', { state: 'waiting' });
    const running = job('cutover', { state: 'running' });
    expect(summariseBackgroundJobs([waiting, failed, running]).kind).toBe('running');
    expect(summariseBackgroundJobs([waiting, failed]).kind).toBe('failed');
    expect(summariseBackgroundJobs([waiting]).kind).toBe('waiting');
  });
});
