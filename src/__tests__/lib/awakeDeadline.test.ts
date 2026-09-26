/**
 * Scenario: an engine job is a Promise and the screen's ceiling is its own, so
 * a wait that runs out has to leave the job alone and say so.
 *
 * Expected behaviour: the work's answer wins when it arrives inside the
 * ceiling, the ceiling wins when it does not, and a suspension does not spend
 * the budget.
 */

import { withAwakeDeadline } from '@/shared/async/awakeDeadline';

jest.useFakeTimers();

afterEach(() => {
  jest.clearAllTimers();
});

it('carries the work through when it lands inside the ceiling', async () => {
  const outcome = withAwakeDeadline(Promise.resolve('wiped'), 60_000, 500);

  await expect(outcome).resolves.toEqual({ state: 'complete', value: 'wiped' });
});

it('gives up at the ceiling and leaves the work running', async () => {
  let settle: (value: string) => void = () => {};
  const work = new Promise<string>((resolve) => {
    settle = resolve;
  });

  const outcome = withAwakeDeadline(work, 1_000, 100);
  await jest.advanceTimersByTimeAsync(1_500);

  await expect(outcome).resolves.toEqual({ state: 'stillRunning' });

  // The job Rust is running does not stop because nobody is waiting.
  settle('wiped later');
  await expect(work).resolves.toBe('wiped later');
});

it('hands a failure back when the caller is still waiting', async () => {
  const outcome = withAwakeDeadline(Promise.reject(new Error('wipe failed')), 60_000, 500);

  await expect(outcome).rejects.toThrow('wipe failed');
});

it('swallows a failure that arrives after the caller gave up', async () => {
  let fail: (reason: Error) => void = () => {};
  const work = new Promise<string>((_, reject) => {
    fail = reject;
  });
  const unhandled = jest.fn();
  process.on('unhandledRejection', unhandled);

  const outcome = withAwakeDeadline(work, 1_000, 100);
  await jest.advanceTimersByTimeAsync(1_500);
  await expect(outcome).resolves.toEqual({ state: 'stillRunning' });

  fail(new Error('wipe failed after the screen stopped watching'));
  await Promise.resolve();
  process.off('unhandledRejection', unhandled);

  expect(unhandled).not.toHaveBeenCalled();
});
