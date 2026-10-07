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
  publishSnapshotQueueTrace,
  readSnapshotQueueReport,
  unpublishSnapshotQueueShape,
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

    const report = trace.report(20_500, 4, 1, 'stalled');

    expect(report).toContain('4 queued, 1 in flight');
    expect(report).toContain('+0ms enqueue a1');
    expect(report).toContain('+15000ms watchdogHeld (w0 rendering)');
  });

  it('says so rather than reporting an empty buffer as a healthy queue', () => {
    expect(createSnapshotQueueTrace().report(1_000, 7, 0, 'stalled')).toContain(
      'no events recorded'
    );
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

describe('the published queue trace', () => {
  beforeEach(() => publishSnapshotQueueTrace(null));

  it('reads nothing until a pool has published its trace', () => {
    expect(readSnapshotQueueReport()).toBeNull();
  });

  it('reads the live trace with the queue shape at the moment of the read', () => {
    const trace = createSnapshotQueueTrace();
    trace.record({ kind: 'enqueue', activityId: 'a1' }, 1_000);
    let shape = { queued: 3, inFlight: 1 };
    publishSnapshotQueueTrace(trace, () => shape);

    expect(readSnapshotQueueReport()).toContain('3 queued, 1 in flight');
    shape = { queued: 0, inFlight: 0 };
    trace.record({ kind: 'drain' }, 1_500);

    const report = readSnapshotQueueReport() as string;
    expect(report).toContain('0 queued, 0 in flight');
    expect(report).toContain('drain');
  });

  it('does not call a drained queue stalled', () => {
    const trace = createSnapshotQueueTrace();
    trace.record({ kind: 'drain' }, 1_000);
    publishSnapshotQueueTrace(trace, () => ({ queued: 0, inFlight: 0 }));

    const report = readSnapshotQueueReport() as string;
    expect(report).not.toContain('stalled');
    expect(report).toContain('idle: 0 queued, 0 in flight');
  });

  it('names the counts of a queue with work without calling it stalled', () => {
    const trace = createSnapshotQueueTrace();
    trace.record({ kind: 'enqueue', activityId: 'a1' }, 1_000);
    publishSnapshotQueueTrace(trace, () => ({ queued: 3, inFlight: 1 }));

    const report = readSnapshotQueueReport() as string;
    expect(report).not.toContain('stalled');
    expect(report).toContain('[SnapshotQueue] queue: 3 queued, 1 in flight');
  });

  it('keeps the stalled word for a report asked for as a stall', () => {
    const trace = createSnapshotQueueTrace();
    trace.record({ kind: 'enqueue', activityId: 'a1' }, 1_000);
    expect(trace.report(2_000, 3, 1, 'stalled')).toContain('stalled: 3 queued, 1 in flight');
  });

  it('keeps the events after the pool goes away, so a stall can be read from another screen', () => {
    const trace = createSnapshotQueueTrace();
    trace.record({ kind: 'watchdogHeld', detail: 'worker rendering' }, 1_000);
    publishSnapshotQueueTrace(trace, () => ({ queued: 2, inFlight: 1 }));

    unpublishSnapshotQueueShape(trace);

    const report = readSnapshotQueueReport() as string;
    expect(report).toContain('watchdogHeld');
    expect(report).toContain('2 queued, 1 in flight');
  });

  it('does not let a replaced pool unpublish its successor', () => {
    const older = createSnapshotQueueTrace();
    const newer = createSnapshotQueueTrace();
    newer.record({ kind: 'enqueue', activityId: 'b2' }, 1_000);
    publishSnapshotQueueTrace(older, () => ({ queued: 0, inFlight: 0 }));
    publishSnapshotQueueTrace(newer, () => ({ queued: 4, inFlight: 0 }));

    unpublishSnapshotQueueShape(older);

    expect(readSnapshotQueueReport()).toContain('4 queued');
  });
});
