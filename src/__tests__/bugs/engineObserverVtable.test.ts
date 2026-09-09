/**
 * Scenario: the generated binding registers the `EngineObserver` vtable at the
 * end of its `initialize()`, and nothing ever called it. `setObserver` still
 * handed Rust a handle, so every notify from a Rust thread reached a null
 * vtable cell and panicked inside uniffi. Forty-five identical entries in the
 * device panic log, and every screen quietly back on its polling timer.
 *
 * Expected behaviour: the binding is initialised before the observer is
 * handed over, and if that initialisation fails the observer is withheld,
 * because a handle Rust cannot call through is worse than none.
 */

const mockGenerated = {
  initialize: jest.fn(),
  VeloqEngine: {
    create: jest.fn(),
  },
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  __esModule: true,
  default: mockGenerated,
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: mockGenerated.VeloqEngine,
}));

const { EngineClient } = require('../../../modules/veloqrs/src/EngineClient');

function freshClient() {
  EngineClient.instance = null;
  return EngineClient.getInstance();
}

function engineStub(calls: string[]) {
  return {
    isInitialized: () => true,
    initOutcome: () => 1,
    setObserver: () => calls.push('setObserver'),
  };
}

describe('the engine observer vtable', () => {
  beforeEach(() => {
    mockGenerated.initialize.mockReset();
    mockGenerated.VeloqEngine.create.mockReset();
  });

  it('registers the binding before handing Rust the observer', () => {
    const calls: string[] = [];
    mockGenerated.initialize.mockImplementation(() => calls.push('initialize'));
    mockGenerated.VeloqEngine.create.mockReturnValue(engineStub(calls));

    expect(freshClient().initWithPath('/tmp/a.db')).toBe(true);
    expect(calls).toEqual(['initialize', 'setObserver']);
  });

  it('withholds the observer when the binding will not initialise', () => {
    const calls: string[] = [];
    mockGenerated.initialize.mockImplementation(() => {
      throw new Error('checksum mismatch');
    });
    mockGenerated.VeloqEngine.create.mockReturnValue(engineStub(calls));

    expect(freshClient().initWithPath('/tmp/b.db')).toBe(true);
    expect(calls).toEqual([]);
  });

  it('initialises once for a client that opens two databases', () => {
    mockGenerated.initialize.mockImplementation(() => {});
    mockGenerated.VeloqEngine.create.mockImplementation(() => engineStub([]));

    const client = freshClient();
    client.initWithPath('/tmp/c.db');
    client.initWithPath('/tmp/d.db');

    expect(mockGenerated.initialize).toHaveBeenCalledTimes(1);
  });
});
