import { followDetection } from '@/features/routes/lib/detectionRun';

/**
 * Scenario: three screens used to tick `pollSectionDetection` every 500 ms,
 * and only the tick that saw completion ran the apply.
 * Expected behaviour: completion arrives on `detectionApplied`, the timer
 * that remains reads progress alone, and a run that dies still ends.
 */

function engineWith(overrides: Record<string, unknown> = {}) {
  const listeners: Record<string, () => void> = {};
  const engine = {
    subscribe: jest.fn((event: string, listener: () => void) => {
      listeners[event] = listener;
      return () => delete listeners[event];
    }),
    pollSectionDetection: jest.fn(() => 'running'),
    getSectionDetectionProgress: jest.fn(() => ({
      phase: 'analyzing',
      completed: 3,
      total: 10,
      percent: 30,
    })),
    ...overrides,
  };
  return { engine, announce: () => listeners.detectionApplied?.() };
}

describe('following a detection run', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('reads progress on the timer and the status only on the event', async () => {
    const { engine, announce } = engineWith();
    const onProgress = jest.fn();

    const { settled } = followDetection(engine as never, { onProgress });

    expect(engine.pollSectionDetection).toHaveBeenCalledTimes(1);
    jest.advanceTimersByTime(2000);
    expect(engine.getSectionDetectionProgress).toHaveBeenCalledTimes(4);
    expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ percent: 30 }));
    expect(engine.pollSectionDetection).toHaveBeenCalledTimes(1);

    engine.pollSectionDetection.mockReturnValue('complete');
    announce();
    await expect(settled).resolves.toBe('complete');
    expect(engine.pollSectionDetection).toHaveBeenCalledTimes(2);
  });

  it('stops the timer once the run has ended', async () => {
    const { engine, announce } = engineWith();
    const { settled } = followDetection(engine as never, { onProgress: jest.fn() });

    engine.pollSectionDetection.mockReturnValue('complete');
    announce();
    await settled;

    engine.getSectionDetectionProgress.mockClear();
    jest.advanceTimersByTime(5000);
    expect(engine.getSectionDetectionProgress).not.toHaveBeenCalled();
  });

  it('catches a run that ended between the start and the subscription', async () => {
    const { engine } = engineWith({ pollSectionDetection: jest.fn(() => 'complete') });
    await expect(followDetection(engine as never).settled).resolves.toBe('complete');
  });

  it('ends the run when the worker dies', async () => {
    const { engine, announce } = engineWith();
    const { settled } = followDetection(engine as never);

    engine.pollSectionDetection.mockReturnValue('error');
    announce();

    await expect(settled).resolves.toBe('error');
  });

  it('gives up on its own budget rather than following for ever', async () => {
    const { engine } = engineWith();
    const { settled } = followDetection(engine as never, { timeoutMs: 1000 });

    jest.advanceTimersByTime(1000);

    await expect(settled).resolves.toBe('timeout');
  });

  it('reports a lapsed budget once and keeps following', async () => {
    const { engine, announce } = engineWith();
    const onLapse = jest.fn();
    const { settled } = followDetection(engine as never, { onLapse, lapseAfterMs: 1000 });

    jest.advanceTimersByTime(3000);
    expect(onLapse).toHaveBeenCalledTimes(1);

    engine.pollSectionDetection.mockReturnValue('complete');
    announce();
    await expect(settled).resolves.toBe('complete');
  });

  it('abandons a run the screen no longer wants', async () => {
    const { engine } = engineWith();
    let active = true;
    const { settled } = followDetection(engine as never, { isActive: () => active });

    active = false;
    jest.advanceTimersByTime(500);

    await expect(settled).resolves.toBe('abandoned');
  });

  it('drops the subscription the moment it is cancelled', async () => {
    const { engine } = engineWith();
    const unsubscribe = jest.fn();
    engine.subscribe.mockReturnValue(unsubscribe);
    const { settled, cancel } = followDetection(engine as never, { onProgress: jest.fn() });

    cancel();

    await expect(settled).resolves.toBe('abandoned');
    expect(unsubscribe).toHaveBeenCalled();
    engine.getSectionDetectionProgress.mockClear();
    jest.advanceTimersByTime(2000);
    expect(engine.getSectionDetectionProgress).not.toHaveBeenCalled();
  });

  it('ends rather than hangs when the host cannot answer', async () => {
    const { engine, announce } = engineWith();
    const { settled } = followDetection(engine as never);

    engine.pollSectionDetection.mockImplementation(() => {
      throw new Error('no host');
    });
    announce();

    await expect(settled).resolves.toBe('error');
  });
});
