/**
 * Scenario: a library that could not be opened is renamed aside and a fresh
 * one takes its place. Init then reports success, so nothing on the handle
 * says the library the athlete had is gone.
 *
 * Expected behaviour: the client passes Rust's report through, once, and
 * answers null before the engine is open and when the call throws. What is
 * shown for it is `Q226`.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockTake = jest.fn();

const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  destroy: jest.fn(),
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  ...jest.requireActual('../../../modules/veloqrs/src/generated/veloqrs'),
  VeloqEngine: { create: () => mockNativeEngine },
  default: { initialize: () => {} },
  takeQuarantineReport: () => mockTake(),
}));

const DB = '/data/routes.db';

const REPORT = { history: 4, geometry: 3, pins: 2, sections: 1, intents: 5 };

function closedClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).bindingInitialised = false;
  (client as any).pendingWrites = [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  return client;
}

describe('the quarantine report', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockTake.mockReturnValue(undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('is null before the engine is open, without calling Rust', () => {
    expect(closedClient().takeQuarantineReport()).toBeNull();
    expect(mockTake).not.toHaveBeenCalled();
  });

  it('carries the counts through when there was one', () => {
    const client = closedClient();
    expect(client.initWithPath(DB)).toBe(true);
    mockTake.mockReturnValue(REPORT);

    expect(client.takeQuarantineReport()).toEqual(REPORT);
  });

  it('is null on a launch that opened the file it was given', () => {
    const client = closedClient();
    client.initWithPath(DB);

    expect(client.takeQuarantineReport()).toBeNull();
  });

  it('is null when the call throws, rather than costing the launch', () => {
    const client = closedClient();
    client.initWithPath(DB);
    mockTake.mockImplementation(() => {
      throw new Error('engine gone');
    });

    expect(client.takeQuarantineReport()).toBeNull();
  });
});
