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

  it('does not give up over a deadline the suspension spent', async () => {
    const time = clock(realNow());
    Date.now = () => time.now();

    let settle: () => void = () => {};
    const engine = {
      runBackup: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          })
      ),
    };

    const copying = runDatabaseBackup(engine, '/tmp/backup.db', { timeoutMs: 60_000 });

    time.advance(600_000);
    for (let tick = 0; tick < 4; tick += 1) {
      time.advance(500);
      await Promise.resolve();
    }
    settle();

    await expect(copying).resolves.toBe('complete');
  });

  it('still gives up on a copy that never finishes while the app is awake', async () => {
    jest.useFakeTimers();
    const engine = { runBackup: jest.fn(() => new Promise<void>(() => {})) };

    // The expectation goes on before the clock moves: the rejection lands
    // inside the tick, and a promise nobody is holding yet takes the run down.
    const copying = expect(
      runDatabaseBackup(engine, '/tmp/backup.db', { timeoutMs: 120 })
    ).rejects.toThrow('did not finish in time');
    await jest.advanceTimersByTimeAsync(2_000);

    await copying;
    jest.useRealTimers();
  });
});

describe('a wipe the app was suspended during', () => {
  const realNow = Date.now;

  afterEach(() => {
    Date.now = realNow;
  });

  /**
   * The wipe is a Promise the engine answers, so the suspension is read by the
   * ceiling's own sampling: a sample that arrives ten minutes after the last
   * one is the process having been away, and the budget is given back.
   */
  it('does not give up over a deadline the suspension spent', async () => {
    const time = clock(realNow());
    Date.now = () => time.now();

    let settle: () => void = () => {};
    const engine = {
      runClearRoutesAndSections: jest.fn(
        () =>
          new Promise<void>((resolve) => {
            settle = resolve;
          })
      ),
    };

    const outcome = runCatalogueClear(engine, 60_000);

    // Away for ten minutes, then a handful of ordinary samples.
    time.advance(600_000);
    for (let tick = 0; tick < 4; tick += 1) {
      time.advance(500);
      await Promise.resolve();
    }
    settle();

    await expect(outcome).resolves.toEqual({
      state: 'complete',
      removed: undefined,
    });
  });

  it('still stops watching a wipe that never finishes while the app is awake', async () => {
    jest.useFakeTimers();
    const engine = {
      runClearRoutesAndSections: jest.fn(() => new Promise<void>(() => {})),
    };

    const outcome = runCatalogueClear(engine, 120);
    await jest.advanceTimersByTimeAsync(2_000);

    await expect(outcome).resolves.toEqual({ state: 'stillRunning' });
    jest.useRealTimers();
  });
});
