import type { BackgroundJob } from '../hooks/useBackgroundJobs';

export type BackgroundJobsSummary =
  | { kind: 'running'; count: number }
  | { kind: 'failed'; count: number }
  | { kind: 'waiting'; count: number; until: number | null }
  | { kind: 'idle'; count: 0 };

/** Whether a job's last run ended early, or the job is stopped now. */
function stoppedEarly(job: BackgroundJob): boolean {
  return (
    job.state === 'failed' ||
    job.lastRun?.outcome === 'failed' ||
    job.lastRun?.outcome === 'stopped'
  );
}

/** A job the engine holds back and resumes by itself. */
function isWaiting(job: BackgroundJob): boolean {
  return job.state === 'waiting' || job.held !== null;
}

/**
 * The one state the jobs entry shows, so the athlete need not open the jobs
 * screen to learn whether anything is running. Running beats failed, failed
 * beats waiting, and waiting beats idle, since a job still working is news
 * a stale failure should not hide, and a failure is news a pause should not.
 */
export function summariseBackgroundJobs(jobs: readonly BackgroundJob[]): BackgroundJobsSummary {
  const running = jobs.filter((job) => job.state === 'running');
  if (running.length > 0) return { kind: 'running', count: running.length };

  const failed = jobs.filter(stoppedEarly);
  if (failed.length > 0) return { kind: 'failed', count: failed.length };

  const waiting = jobs.filter(isWaiting);
  if (waiting.length > 0) {
    const times = waiting
      .map((job) => job.held?.until ?? job.resumesAt)
      .filter((time): time is number => time !== null);
    return {
      kind: 'waiting',
      count: waiting.length,
      until: times.length > 0 ? Math.min(...times) : null,
    };
  }
  return { kind: 'idle', count: 0 };
}
