/**
 * Scenario: iOS suspends the app outside its declared background modes, so no
 * timer fires while it is away. Both pollers measure their deadline against
 * `Date.now()`, so the first poll after a three-minute suspension finds an
 * elapsed clock and unchanged counters, and reports a healthy run stuck.
 *
 * Expected behaviour: a deadline counts the time the process was awake. A gap
 * far longer than the poll interval is a suspension, not a run standing still,
 * and the poll that follows it gets its budget back.
 */

import { createAwakeClock } from '@/shared/app/awakeClock';
import { pollDownloadProgress } from '@/features/routes/lib/gpsDownloadPoll';
import { runDatabaseBackup } from '@/features/settings/lib/runBackup';
import { runCatalogueClear } from '@/shared/native/engineClears';

const noWait = () => Promise.resolve();

function clock(start = 0) {
  let at = start;
  return { now: () => at, advance: (ms: number) => (at += ms) };
}

describe('a clock that does not count a suspension', () => {
  it('passes ordinary ticks through', () => {
    const time = clock(1_000);
    const awake = createAwakeClock(100, time.now);

    const first = awake();
    time.advance(100);
    time.advance(100);

    expect(awake() - first).toBe(200);
  });

  it('counts a gap far longer than the interval as time the process was away', () => {
    const time = clock();
    const awake = createAwakeClock(100, time.now);

    const first = awake();
    time.advance(180_000);

    expect(awake() - first).toBe(100);
  });

  it('still counts a tick that is merely slow', () => {
    const time = clock();
    const awake = createAwakeClock(100, time.now);

    const first = awake();
    time.advance(900);

    expect(awake() - first).toBe(900);
  });

  it('keeps its budget across several suspensions', () => {
    const time = clock();
    const awake = createAwakeClock(100, time.now);

    const first = awake();
    time.advance(180_000);
    awake();
    time.advance(100);
    awake();
    time.advance(180_000);

    expect(awake() - first).toBe(300);
  });
});

describe('a GPS download the app was suspended during', () => {
  it('is not stalled by the clock the resume brings back', async () => {
    const time = clock();
    let polls = 0;
    // The download is moving, but the suspension lands between two activities,
    // so the poll on resume reads the counters it left with.
    const read = jest.fn(() => {
      polls += 1;
      if (polls === 2) time.advance(180_000);
      else time.advance(100);
      return { active: polls < 6, completed: polls < 3 ? 1 : polls, total: 20 };
    });

    const outcome = await pollDownloadProgress({
      read,
      wait: noWait,
      now: time.now,
      stallMs: 120_000,
    });

    expect(outcome).toBe('settled');
  });

  it('still gives up on a download that stands still while the app is awake', async () => {
    const time = clock();
    const read = jest.fn(() => {
      time.advance(1_000);
      return { active: true, completed: 4, total: 10 };
    });

    const outcome = await pollDownloadProgress({
      read,
      wait: noWait,
      now: time.now,
      intervalMs: 1_000,
      stallMs: 120_000,
    });

    expect(outcome).toBe('stalled');
  });
});

describe('a backup the app was suspended during', () => {
  const realNow = Date.now;

  afterEach(() => {
    Date.now = realNow;
  });

  function clockJumpingOnceAfter(polls: number, by: number) {
    const time = clock(realNow());
    let reads = 0;
    Date.now = () => {
      reads += 1;
      if (reads === polls) time.advance(by);
      return time.now();
    };
    return time;
  }

  it('does not throw over a deadline the suspension spent', async () => {
    const time = clockJumpingOnceAfter(2, 600_000);
    let polls = 0;
    const engine = {
      startBackup: jest.fn(),
      pollBackup: jest.fn(() => {
        polls += 1;
        time.advance(10);
        return polls < 4 ? 'running' : 'complete';
      }),
    };

    await expect(runDatabaseBackup(engine, '/tmp/backup.db', 60_000)).resolves.toBeUndefined();
  });

  it('still gives up on a copy that never finishes while the app is awake', async () => {
    const engine = {
      startBackup: jest.fn(),
      pollBackup: jest.fn(() => 'running'),
    };

    await expect(runDatabaseBackup(engine, '/tmp/backup.db', 120)).rejects.toThrow(
      'did not finish in time'
    );
  });
});

describe('a wipe the app was suspended during', () => {
  const realNow = Date.now;

  afterEach(() => {
    Date.now = realNow;
  });

  it('does not throw over a deadline the suspension spent', async () => {
    const time = clock(realNow());
    let reads = 0;
    Date.now = () => {
      reads += 1;
      if (reads === 2) time.advance(600_000);
      return time.now();
    };
    let polls = 0;
    const engine = {
      startClearRoutesAndSections: jest.fn(),
      pollClearRoutesAndSections: jest.fn(() => {
        polls += 1;
        time.advance(10);
        return polls < 4 ? 'running' : 'complete';
      }),
    };

    await expect(runCatalogueClear(engine, 60_000)).resolves.toBeUndefined();
  });

  it('still gives up on a wipe that never finishes while the app is awake', async () => {
    const engine = {
      startClearRoutesAndSections: jest.fn(),
      pollClearRoutesAndSections: jest.fn(() => 'running'),
    };

    await expect(runCatalogueClear(engine, 120)).rejects.toThrow('did not finish in time');
  });
});
