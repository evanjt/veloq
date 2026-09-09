/**
 * Scenario: metrics arrive before the engine is open. `setActivityMetrics` is
 * the one write the client holds rather than drops, and demo entry issues
 * several of them in the window between `enterDemoMode` and `initWithPath`.
 *
 * Expected behaviour: every batch held before init reaches the engine once it
 * opens, in the order it was written.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';
import type { FfiActivityMetrics } from '../../../modules/veloqrs/src/generated/veloqrs';

const mockActivities = { setMetrics: jest.fn() };
const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  destroy: jest.fn(),
  activities: () => mockActivities,
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: {
    create: () => mockNativeEngine,
  },
}));

const DB = '/data/routes.db';

function metric(id: string): FfiActivityMetrics {
  return { activityId: id } as unknown as FfiActivityMetrics;
}

function closedClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).pendingWrites = [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return client;
}

describe('metrics written before the engine opens', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('replays every held batch, not only the last', () => {
    const client = closedClient();

    client.setActivityMetrics([metric('a'), metric('b')]);
    client.setActivityMetrics([metric('c')]);
    expect(mockActivities.setMetrics).not.toHaveBeenCalled();

    expect(client.initWithPath(DB)).toBe(true);

    // One call per batch, in order. `set_activity_metrics_extended` is
    // INSERT OR REPLACE per row, so a batch per call stores what one
    // concatenated call would.
    expect(mockActivities.setMetrics).toHaveBeenCalledTimes(2);
    expect(mockActivities.setMetrics.mock.calls[0][0]).toEqual([metric('a'), metric('b')]);
    expect(mockActivities.setMetrics.mock.calls[1][0]).toEqual([metric('c')]);
  });

  it('holds nothing when an empty batch is the only pre-init write', () => {
    const client = closedClient();

    client.setActivityMetrics([]);
    client.initWithPath(DB);

    expect(mockActivities.setMetrics).not.toHaveBeenCalled();
  });

  it('makes no replay call when nothing was written before init', () => {
    const client = closedClient();

    client.initWithPath(DB);

    expect(mockActivities.setMetrics).not.toHaveBeenCalled();
  });

  it('writes straight through once the engine is open', () => {
    const client = closedClient();
    client.initWithPath(DB);

    client.setActivityMetrics([metric('d')]);

    expect(mockActivities.setMetrics).toHaveBeenCalledTimes(1);
    expect(mockActivities.setMetrics).toHaveBeenLastCalledWith([metric('d')]);
  });

  it('drops what it held when the engine is torn down before it opens', () => {
    const client = closedClient();

    client.setActivityMetrics([metric('e')]);
    client.destroyEngine();
    client.initWithPath(DB);

    expect(mockActivities.setMetrics).not.toHaveBeenCalled();
  });
});
