/**
 * Scenario: the athlete taps retry on the init banner while the previous run's
 * half-second retry timer is still pending, or navigates away mid-prompt.
 *
 * Expected behaviour: the abandoned run makes no further attempt and reports
 * nothing. Two live chains both reach the success block, so launch asks the
 * backfill and cutover questions twice.
 */
import { runEngineInit, startEngineInitRun } from '@/shared/app/engineInitRun';

jest.useFakeTimers();

describe('engine init run', () => {
  beforeEach(() => jest.clearAllTimers());

  it('retries once when the open fails for a retryable reason', async () => {
    const run = startEngineInitRun();
    const attempts: number[] = [];
    let gaveUp = 0;

    await runEngineInit(run, {
      attempt: async (n) => {
        attempts.push(n);
        return 'failed';
      },
      retryable: () => true,
      giveUp: () => {
        gaveUp += 1;
      },
    });

    expect(attempts).toEqual([0]);
    jest.advanceTimersByTime(500);
    await Promise.resolve();
    await Promise.resolve();
    expect(attempts).toEqual([0, 1]);
    expect(gaveUp).toBe(1);
  });

  it('drops the pending retry when the run is cancelled', async () => {
    const run = startEngineInitRun();
    const attempts: number[] = [];
    let gaveUp = 0;

    await runEngineInit(run, {
      attempt: async (n) => {
        attempts.push(n);
        return 'failed';
      },
      retryable: () => true,
      giveUp: () => {
        gaveUp += 1;
      },
    });
    expect(attempts).toEqual([0]);

    run.cancel();
    jest.advanceTimersByTime(5000);
    await Promise.resolve();

    expect(attempts).toEqual([0]);
    expect(gaveUp).toBe(0);
  });

  it('schedules nothing once the run is already cancelled', async () => {
    const run = startEngineInitRun();
    let gaveUp = 0;

    const chain = runEngineInit(run, {
      attempt: async () => 'failed',
      retryable: () => true,
      giveUp: () => {
        gaveUp += 1;
      },
    });
    run.cancel();
    await chain;

    expect(jest.getTimerCount()).toBe(0);
    jest.advanceTimersByTime(5000);
    await Promise.resolve();
    await Promise.resolve();
    expect(gaveUp).toBe(0);
  });

  it('leaves a waiting identity question alone rather than retrying it', async () => {
    const run = startEngineInitRun();
    let gaveUp = 0;

    await runEngineInit(run, {
      attempt: async () => 'waiting',
      retryable: () => true,
      giveUp: () => {
        gaveUp += 1;
      },
    });

    expect(gaveUp).toBe(0);
    expect(jest.getTimerCount()).toBe(0);
  });

  it('gives up without a timer when the outcome cannot lift on its own', async () => {
    const run = startEngineInitRun();
    let gaveUp = 0;

    await runEngineInit(run, {
      attempt: async () => 'failed',
      retryable: () => false,
      giveUp: () => {
        gaveUp += 1;
      },
    });

    expect(gaveUp).toBe(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
