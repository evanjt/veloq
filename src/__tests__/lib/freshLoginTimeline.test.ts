/**
 * Scenario: a fresh library syncs for minutes while the FFI ring holds only
 * the last 500 calls. Expected behaviour: the run keeps its sync step
 * durations and first visible milestones through settlement, and says which
 * are unobserved.
 */
import { SyncState, SyncStep } from 'veloqrs';

import { createFreshLoginTimeline } from '@/shared/debug/freshLoginTimeline';
import { recordFFIMetric } from '@/shared/debug/renderTimer';

function setup(maxRuns?: number) {
  let t = 1000;
  const timeline = createFreshLoginTimeline({
    now: () => t,
    build: 'abc1234',
    ...(maxRuns ? { maxRuns } : {}),
  });
  return {
    timeline,
    advance: (ms: number) => {
      t += ms;
    },
  };
}

const syncing = (step?: SyncStep) => ({ state: SyncState.Syncing, step });
const idle = (lastError?: string) => ({ state: SyncState.Idle, lastError });

describe('fresh-login timeline', () => {
  it('records each named step duration and the settled outcome', () => {
    const { timeline, advance } = setup();
    timeline.observeSync(syncing(SyncStep.Athlete));
    advance(300);
    timeline.observeSync(syncing(SyncStep.Wellness));
    advance(700);
    timeline.observeSync(idle());

    const [run] = timeline.runs();
    expect(run.outcome).toBe('success');
    expect(run.totalMs).toBe(1000);
    expect(run.steps).toEqual([
      { step: 'Athlete', startMs: 0, durationMs: 300 },
      { step: 'Wellness', startMs: 300, durationMs: 700 },
    ]);
    expect(run.build).toBe('abc1234');
    expect(run.clock).toBe('observer');
  });

  it('does not restart a step for a repeated snapshot of the same step', () => {
    const { timeline, advance } = setup();
    timeline.observeSync(syncing(SyncStep.Athlete));
    advance(100);
    timeline.observeSync(syncing(SyncStep.Athlete));
    advance(100);
    timeline.observeSync(idle());
    expect(timeline.runs()[0].steps).toEqual([{ step: 'Athlete', startMs: 0, durationMs: 200 }]);
  });

  it('keeps the first milestone and marks unobserved ones null', () => {
    const { timeline, advance } = setup();
    timeline.observeSync(syncing(SyncStep.Athlete));
    advance(2000);
    timeline.mark('firstCard');
    advance(500);
    timeline.mark('firstCard');
    timeline.observeSync(idle());

    const [run] = timeline.runs();
    expect(run.milestones).toEqual({ firstCard: 2000, firstMap: null, backfillSettled: 2500 });
  });

  it('leaves backfill unobserved when the run fails', () => {
    const { timeline, advance } = setup();
    timeline.observeSync(syncing(SyncStep.Athlete));
    advance(50);
    timeline.observeSync(idle('network'));
    const [run] = timeline.runs();
    expect(run.outcome).toBe('failed');
    expect(run.milestones.backfillSettled).toBeNull();
  });

  it('treats an expired credential as failed', () => {
    const { timeline } = setup();
    timeline.observeSync(syncing(SyncStep.Athlete));
    timeline.observeSync({ state: SyncState.AuthExpired });
    expect(timeline.runs()[0].outcome).toBe('failed');
  });

  it('reports a requested stop as cancelled, not success', () => {
    const { timeline, advance } = setup();
    timeline.observeSync(syncing(SyncStep.Activities));
    advance(10);
    timeline.markCancelRequested();
    timeline.observeSync(idle());
    const [run] = timeline.runs();
    expect(run.outcome).toBe('cancelled');
    expect(run.milestones.backfillSettled).toBeNull();
  });

  it('closes the open step when the run ends and keeps repeated runs apart', () => {
    const { timeline, advance } = setup();
    timeline.observeSync(syncing(SyncStep.Athlete));
    advance(10);
    timeline.observeSync(idle());
    timeline.observeSync(syncing(SyncStep.Athlete));
    advance(20);
    timeline.observeSync(idle());

    const runs = timeline.runs();
    expect(runs.map((r) => r.totalMs)).toEqual([10, 20]);
    expect(runs[1].startedAtMs).toBeGreaterThan(runs[0].startedAtMs);
  });

  it('ignores marks and idle snapshots before any run', () => {
    const { timeline } = setup();
    timeline.mark('firstCard');
    timeline.observeSync(idle());
    timeline.observeSync(null);
    expect(timeline.runs()).toEqual([]);
  });

  it('keeps first milestones through more than 500 unrelated metrics', () => {
    const { timeline, advance } = setup();
    timeline.observeSync(syncing(SyncStep.Athlete));
    advance(100);
    timeline.mark('firstMap');
    for (let i = 0; i < 1200; i++) recordFFIMetric('getActivities', 1);
    advance(900);
    timeline.observeSync(idle());
    expect(timeline.runs()[0].milestones.firstMap).toBe(100);
  });

  it('bounds the retained runs and the steps per run', () => {
    const { timeline, advance } = setup(2);
    for (let r = 0; r < 4; r++) {
      timeline.observeSync(syncing(SyncStep.Athlete));
      for (let i = 0; i < 100; i++) {
        advance(1);
        timeline.observeSync(syncing(i % 2 ? SyncStep.Wellness : SyncStep.Census));
      }
      timeline.observeSync(idle());
    }
    const runs = timeline.runs();
    expect(runs).toHaveLength(2);
    expect(runs[0].steps.length).toBeLessThanOrEqual(32);
  });

  it('clear drops every run', () => {
    const { timeline } = setup();
    timeline.observeSync(syncing(SyncStep.Athlete));
    timeline.clear();
    expect(timeline.runs()).toEqual([]);
  });
});
