/**
 * Scenario: the sync line sat on its first step through five refreshes and a
 * relaunch while Rust's announce thread kept waking, and nothing on any screen
 * could say where between the Rust callback and the listener the event went.
 *
 * Expected behaviour: the client counts every announcement the moment it lands
 * in JavaScript, counts every delivery that found a listener, and reports both
 * beside the listener counts and the reason registration failed, so a phone in
 * hand can read which side of the seam is silent.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockFlags = { initialiseThrows: false };

type Observer = Record<string, (...args: unknown[]) => void>;
let registered: Observer | null = null;

const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn((observer: Observer) => {
    registered = observer;
  }),
  destroy: jest.fn(),
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: {
    create: () => mockNativeEngine,
  },
  default: {
    initialize: () => {
      if (mockFlags.initialiseThrows) throw new Error('checksum mismatch: get_stats');
    },
  },
}));

const DB = '/data/routes.db';
const flush = () => new Promise((resolve) => setImmediate(resolve));

function closedClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).bindingInitialised = false;
  (client as any).observerRegistered = false;
  (client as any).pendingWrites = [];
  (client as any).listeners = new Map();
  (client as any).received = new Map();
  (client as any).delivered = new Map();
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return client;
}

describe('what the engine event seam reports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlags.initialiseThrows = false;
    registered = null;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('says nothing has arrived before the engine opens', () => {
    const report = closedClient().engineEventDiagnostics();
    expect(report.live).toBe(false);
    expect(report.bindingInitError).toBeNull();
    expect(report.observerError).toBeNull();
    expect(report.received).toEqual({});
  });

  it('names the checksum failure that withheld the observer', () => {
    mockFlags.initialiseThrows = true;
    const client = closedClient();
    client.initWithPath(DB);
    const report = client.engineEventDiagnostics();
    expect(report.live).toBe(false);
    expect(report.bindingInitError).toContain('checksum mismatch: get_stats');
  });

  it('counts arrivals, deliveries and listeners per channel', async () => {
    const client = closedClient();
    client.initWithPath(DB);
    expect(registered).not.toBeNull();
    const off = client.subscribe('syncProgress', () => {});
    const offAgain = client.subscribe('syncProgress', () => {});

    registered!.syncProgress();
    registered!.syncProgress();
    registered!.bodyStored('power_curve', 'a1');
    await flush();

    const report = client.engineEventDiagnostics();
    expect(report.live).toBe(true);
    expect(report.received).toEqual({ syncProgress: 2, bodyStored: 1 });
    expect(report.delivered).toEqual({ syncProgress: 2 });
    expect(report.listeners).toEqual({ syncProgress: 2 });
    off();
    offAgain();
  });

  it('counts an arrival even when no listener is there to take it', async () => {
    const client = closedClient();
    client.initWithPath(DB);

    registered!.tilesGenerated();
    await flush();

    const report = client.engineEventDiagnostics();
    expect(report.received).toEqual({ tilesGenerated: 1 });
    expect(report.delivered).toEqual({});
  });
});
