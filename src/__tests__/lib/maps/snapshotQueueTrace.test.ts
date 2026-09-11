/**
 * Scenario: the preview render queue stops moving on a release build, where
 * every existing log in the pool has been stripped.
 * Expected behaviour: the last few dozen queue events survive in memory and
 * come out as one report the moment the watchdog has held long enough for the
 * queue to be wedged rather than busy.
 */

import {
  HOLDS_BEFORE_REPORT,
  TRACE_CAPACITY,
  createSnapshotQueueTrace,
  formatTraceEvent,
  holdShouldReport,
} from '@/features/maps/lib/snapshotQueueTrace';

describe('snapshotQueueTrace', () => {
  it('keeps the most recent events and drops the oldest', () => {
    const trace = createSnapshotQueueTrace(3);

    trace.record({ kind: 'enqueue', activityId: 'a1' }, 1_000);
    trace.record({ kind: 'enqueue', activityId: 'a2' }, 1_001);
    trace.record({ kind: 'enqueue', activityId: 'a3' }, 1_002);
    trace.record({ kind: 'start', activityId: 'a1', workerId: 0 }, 1_003);

    expect(trace.events().map((event) => event.activityId)).toEqual(['a2', 'a3', 'a1']);
  });

  it('times every line from the oldest event it still holds', () => {
    const trace = createSnapshotQueueTrace();

    trace.record({ kind: 'enqueue', activityId: 'a1' }, 5_000);
    trace.record({ kind: 'watchdogHeld', detail: 'w0 rendering' }, 20_000);

    const report = trace.report(20_500, 4, 1);

    expect(report).toContain('4 queued, 1 in flight');
    expect(report).toContain('+0ms enqueue a1');
    expect(report).toContain('+15000ms watchdogHeld (w0 rendering)');
  });

  it('says so rather than reporting an empty buffer as a healthy queue', () => {
    expect(createSnapshotQueueTrace().report(1_000, 7, 0)).toContain('no events recorded');
  });

  it('names the worker and the reason when there is one', () => {
    const line = formatTraceEvent(
      { at: 1_200, kind: 'fail', activityId: 'a9', workerId: 2, detail: 'timeout' },
      1_000
    );

    expect(line).toBe('+200ms fail w2 a9 (timeout)');
  });

  it('reports a run of holds exactly once', () => {
    const reported = [];
    for (let holds = 1; holds <= HOLDS_BEFORE_REPORT * 3; holds++) {
      if (holdShouldReport(holds)) reported.push(holds);
    }

    expect(reported).toEqual([HOLDS_BEFORE_REPORT]);
  });

  it('does not report a hold or two, which is a busy pool rather than a stuck one', () => {
    expect(holdShouldReport(1)).toBe(false);
    expect(holdShouldReport(HOLDS_BEFORE_REPORT - 1)).toBe(false);
  });

  it('clears to empty, so a drained queue does not report the last stall again', () => {
    const trace = createSnapshotQueueTrace();
    trace.record({ kind: 'enqueue', activityId: 'a1' }, 1_000);

    trace.clear();

    expect(trace.events()).toHaveLength(0);
  });

  it('holds two worker passes over a feed page by default', () => {
    expect(TRACE_CAPACITY).toBeGreaterThanOrEqual(32);
  });
});
