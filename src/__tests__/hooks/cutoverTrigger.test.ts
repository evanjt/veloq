/**
 * Scenario: the detector cutover has to fire once on an install that saved
 * Corridor, and never on one that is already done, mid-run, or still fetching
 * elevation.
 * Expected behaviour: the SQLite token is the only done-marker, so a refusal
 * costs one launch and nothing is written on the JS side.
 */

import { getEngine } from '@/shared/native/engine';
import { startDetectorCutoverAfterUpdate } from '@/features/routes/lib/cutoverTrigger';

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

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('does nothing when the migration is not owed', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ pending: false, start }));

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('does nothing while a run is already in flight', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ running: true, start }));

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('waits for the elevation backfill rather than cutting a half-elevated library', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ remaining: 12, start }));

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('declines when the remaining count is unreadable rather than cutting', async () => {
    const start = jest.fn(() => true);
    mockGetEngine.mockReturnValue(engineWith({ remaining: null, start }));

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(false);
    expect(start).not.toHaveBeenCalled();
  });

  it('costs one launch when the engine throws', async () => {
    mockGetEngine.mockReturnValue({
      isCutoverPending: jest.fn(() => {
        throw new Error('engine gone');
      }),
    } as unknown as ReturnType<typeof getEngine>);

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(false);
  });

  it('answers false with no engine', async () => {
    mockGetEngine.mockReturnValue(null);

    await expect(startDetectorCutoverAfterUpdate()).resolves.toBe(false);
  });
});
