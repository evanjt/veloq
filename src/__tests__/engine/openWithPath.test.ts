/**
 * Scenario: the first launch after an update opens a library whose schema is
 * older than the build's, so the open runs a migration chain.
 *
 * Expected behaviour: the client starts that open on a Rust thread and polls it
 * to a terminal state instead of calling the blocking constructor while the
 * upgrade runs. A library with nothing to upgrade keeps the one-call open. A
 * failed open leaves the engine closed with Rust's reason, and an upgrade that
 * outlasts the deadline is reported as failed without a blocking retry.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const OPENED = 1;
const BUSY = 2;
const RUNNING = 2;
const FINISHED = 3;

const mockCreate = jest.fn();
const mockStart = jest.fn();
const mockProgress = jest.fn();

const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  destroy: jest.fn(),
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  ...jest.requireActual('../../../modules/veloqrs/src/generated/veloqrs'),
  VeloqEngine: {
    create: (path: string) => {
      mockCreate(path);
      return mockNativeEngine;
    },
  },
  default: { initialize: () => {} },
  startEngineOpen: (path: string) => mockStart(path),
  getEngineOpenProgress: () => mockProgress(),
}));

const DB = '/data/routes.db';

function closedClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialised = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).bindingInitialised = false;
  (client as any).pendingWrites = [];
  (client as any).lastInitOutcome = 5;
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return client;
}

describe('openWithPath', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
    jest.useRealTimers();
  });

  it('opens a library with nothing to upgrade with the one blocking call', async () => {
    mockStart.mockReturnValue(6);
    const client = closedClient();

    await expect(client.openWithPath(DB)).resolves.toBe(true);

    expect(mockProgress).not.toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(client.isInitialized()).toBe(true);
  });

  it('polls an upgrading open to its end and builds the handle only after it', async () => {
    jest.useFakeTimers();
    mockStart.mockReturnValue(1);
    mockProgress
      .mockReturnValueOnce({ phase: RUNNING })
      .mockReturnValueOnce({ phase: RUNNING })
      .mockReturnValue({ phase: FINISHED, outcome: OPENED, schemaVersion: 73 });
    const client = closedClient();

    const opened = client.openWithPath(DB);
    await jest.advanceTimersByTimeAsync(0);
    expect(mockStart).toHaveBeenCalledWith(DB);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(client.isInitialized()).toBe(false);

    await jest.advanceTimersByTimeAsync(1_000);

    await expect(opened).resolves.toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
    expect(client.isInitialized()).toBe(true);
  });

  it('reports the reason and stays closed when the upgrade could not open the file', async () => {
    jest.useFakeTimers();
    mockStart.mockReturnValue(1);
    mockProgress.mockReturnValue({ phase: FINISHED, outcome: BUSY });
    const client = closedClient();

    const opened = client.openWithPath(DB);
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(opened).resolves.toBe(false);
    expect(client.initOutcome()).toBe(BUSY);
    expect(client.isInitialized()).toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
  });

  it('gives up at the deadline without falling back to the blocking open', async () => {
    jest.useFakeTimers();
    mockStart.mockReturnValue(1);
    mockProgress.mockReturnValue({ phase: RUNNING });
    const client = closedClient();

    const opened = client.openWithPath(DB);
    await jest.advanceTimersByTimeAsync(60 * 60 * 1_000);

    await expect(opened).resolves.toBe(false);
    expect(mockCreate).not.toHaveBeenCalled();
    expect(client.isInitialized()).toBe(false);
  });

  it('waits on an open already running rather than starting a second', async () => {
    jest.useFakeTimers();
    mockStart.mockReturnValue(2);
    mockProgress.mockReturnValue({ phase: FINISHED, outcome: OPENED });
    const client = closedClient();

    const opened = client.openWithPath(DB);
    await jest.advanceTimersByTimeAsync(1_000);

    await expect(opened).resolves.toBe(true);
  });

  it('falls back to the blocking open when the start throws', async () => {
    mockStart.mockImplementation(() => {
      throw new Error('binding gone');
    });
    const client = closedClient();

    await expect(client.openWithPath(DB)).resolves.toBe(true);
    expect(mockCreate).toHaveBeenCalledTimes(1);
  });
});
