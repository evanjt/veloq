import { runWhenIdle, IDLE_DEADLINE_MS } from '@/shared/async/runWhenIdle';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';

describe('runWhenIdle', () => {
  let idle: IdleScheduler;
  beforeEach(() => {
    idle = stubIdleScheduler('queued');
  });
  afterEach(() => idle.restore());

  it('holds the task until the thread is idle', () => {
    const task = jest.fn();
    runWhenIdle(task);
    expect(task).not.toHaveBeenCalled();
    idle.flush();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('never runs a task that was cancelled first', () => {
    const task = jest.fn();
    const cancel = runWhenIdle(task);
    cancel();
    idle.flush();
    expect(task).not.toHaveBeenCalled();
    expect(idle.pending()).toBe(0);
  });

  it('is safe to cancel twice and after the run', () => {
    const task = jest.fn();
    const cancel = runWhenIdle(task);
    idle.flush();
    cancel();
    cancel();
    expect(task).toHaveBeenCalledTimes(1);
  });

  it('asks for a deadline so a busy thread cannot hold the work back for ever', () => {
    const request = jest.spyOn(globalThis as never, 'requestIdleCallback' as never);
    runWhenIdle(() => {});
    expect((request.mock.calls[0] as unknown[])[1]).toEqual({ timeout: IDLE_DEADLINE_MS });
  });
});
