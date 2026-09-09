/**
 * Scenario: the detector cutover has to fire once on an install that saved
 * Corridor, and never on one that is already done, mid-run, or still fetching
 * elevation.
 * Expected behaviour: the SQLite token is the only done-marker, so a refusal
 * costs one launch and nothing is written on the JS side. Each refusal names
 * itself, because a cutover that is already done and one waiting on the
 * backfill want opposite things from the retry ladder above.
 */

import { isRetryableStart, StartOutcome } from 'veloqrs';

import { getEngine } from '@/shared/native/engine';
import { startDetectorCutoverAfterUpdate } from '@/features/routes/lib/cutoverTrigger';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/engine', () => ({
  getEngine: jest.fn(),
}));

const mockGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

interface EngineParts {
  pending?: boolean;
  running?: boolean;
  remaining?: number | null;
  start?: jest.Mock;
}

function engineWith({ pending = true, running = false, remaining = 0, start }: EngineParts) {
  return {
    isCutoverPending: jest.fn(() => pending),
    isCutoverRunning: jest.fn(() => running),
    getElevationBackfillRemaining: jest.fn(() => remaining),
    startDetectorCutover: start ?? jest.fn(() => true),
  } as unknown as ReturnType<typeof getEngine>;
}

describe('startDetectorCutoverAfterUpdate', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('starts a run when the migration is owed and the library is elevated', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ start }));

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(StartOutcome.Started);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('says the migration is not owed, which no later launch changes', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ pending: false, start }));

    const outcome = await startDetectorCutoverAfterUpdate();
    expect(outcome).toBe(StartOutcome.NotOwed);
    expect(isRetryableStart(outcome)).toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('says the slot is busy while a run is already in flight', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ running: true, start }));

    const outcome = await startDetectorCutoverAfterUpdate();
    expect(outcome).toBe(StartOutcome.Busy);
    expect(isRetryableStart(outcome)).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it('waits for the elevation backfill rather than cutting a half-elevated library', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ remaining: 12, start }));

    const outcome = await startDetectorCutoverAfterUpdate();
    expect(outcome).toBe(StartOutcome.Held);
    expect(isRetryableStart(outcome)).toBe(true);
    expect(start).not.toHaveBeenCalled();
  });

  it('declines when the remaining count is unreadable rather than cutting', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ remaining: null, start }));

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(StartOutcome.Held);
    expect(start).not.toHaveBeenCalled();
  });

  it('costs one launch when the engine throws', async () => {
    mockGetEngine.mockReturnValue({
      isCutoverPending: jest.fn(() => {
        throw new Error('engine gone');
      }),
    } as unknown as ReturnType<typeof getEngine>);

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(StartOutcome.Failed);
  });

  it('says it was early, not refused, with no engine', async () => {
    mockGetEngine.mockReturnValue(null);

    const outcome = await startDetectorCutoverAfterUpdate();
    expect(outcome).toBe(StartOutcome.NotReady);
    expect(isRetryableStart(outcome)).toBe(true);
  });

  it('tells the four refusals apart, which one boolean could not', async () => {
    const seen = new Set<StartOutcome>();
    for (const parts of [
      { pending: false },
      { running: true },
      { remaining: 9 },
      {},
    ] as EngineParts[]) {
      mockGetEngine.mockReturnValue(engineWith(parts));
      seen.add(await startDetectorCutoverAfterUpdate());
    }
    expect(seen.size).toBe(4);
  });
});
