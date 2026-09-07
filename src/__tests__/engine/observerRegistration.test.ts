/**
 * Scenario: the generated binding's checksum check throws, which is what a
 * Rust library out of step with its bindings does, so `setObserver` is
 * withheld and Rust announces nothing.
 *
 * Expected behaviour: the client says so. A caller with no polling fallback
 * needs to read that the event channel is dead, not infer it from a
 * `console.warn` that release strips.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockFlags = { initialiseThrows: false, setObserverThrows: false };

const mockNativeEngine = {
  isInitialized: () => true,
  setObserver: jest.fn(() => {
    if (mockFlags.setObserverThrows) throw new Error('observer refused');
  }),
  destroy: jest.fn(),
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  VeloqEngine: {
    create: () => mockNativeEngine,
  },
  default: {
    initialize: () => {
      if (mockFlags.initialiseThrows) throw new Error('checksum mismatch');
    },
  },
}));

const DB = '/data/routes.db';

function closedClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).bindingInitialised = false;
  (client as any).observerRegistered = false;
  (client as any).pendingWrites = [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return client;
}

describe('whether Rust can announce anything', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockFlags.initialiseThrows = false;
    mockFlags.setObserverThrows = false;
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is not live before the engine opens', () => {
    expect(closedClient().eventsAreLive()).toBe(false);
  });

  it('is live once the observer is registered', () => {
    const client = closedClient();
    expect(client.initWithPath(DB)).toBe(true);
    expect(mockNativeEngine.setObserver).toHaveBeenCalledTimes(1);
    expect(client.eventsAreLive()).toBe(true);
  });

  it('is not live when the checksum check throws', () => {
    mockFlags.initialiseThrows = true;
    const client = closedClient();
    expect(client.initWithPath(DB)).toBe(true);
    expect(mockNativeEngine.setObserver).not.toHaveBeenCalled();
    expect(client.eventsAreLive()).toBe(false);
  });

  it('is not live when the engine refuses the observer', () => {
    mockFlags.setObserverThrows = true;
    const client = closedClient();
    expect(client.initWithPath(DB)).toBe(true);
    expect(client.eventsAreLive()).toBe(false);
  });
});
