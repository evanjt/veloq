/**
 * Scenario: the engine rejects a profile write, a sport-settings write or a
 * recomputation request.
 *
 * Expected behaviour: each failure is logged with the export's name, and
 * `markForRecomputation` reports whether it applied.
 */

import { EngineClient } from '../../../modules/veloqrs/src/EngineClient';

const mockSettings = {
  setAthleteProfile: jest.fn(),
  setSportSettings: jest.fn(),
};
const mockNativeEngine = {
  isInitialized: () => true,
  initOutcome: () => 1,
  setObserver: jest.fn(),
  settings: () => mockSettings,
  markForRecomputation: jest.fn(),
};

jest.mock('../../../modules/veloqrs/src/generated/veloqrs', () => ({
  FfiInitOutcome: { Opened: 1, NotAttempted: 5, Failed: 6 },
  VeloqEngine: { create: () => mockNativeEngine },
}));

function openClient() {
  const client = EngineClient.getInstance();
  /* eslint-disable @typescript-eslint/no-explicit-any */
  (client as any).initialized = false;
  (client as any).dbPath = null;
  (client as any).engine = null;
  (client as any).pendingWrites = [];
  /* eslint-enable @typescript-eslint/no-explicit-any */
  expect(client.initWithPath('/data/routes.db')).toBe(true);
  return client;
}

describe('engine write failures', () => {
  let errorSpy: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => errorSpy.mockRestore());

  it('logs a failed athlete profile write by name', () => {
    const client = openClient();
    mockSettings.setAthleteProfile.mockImplementation(() => {
      throw new Error('database is locked');
    });

    client.setAthleteProfile('{}');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('setAthleteProfile'),
      expect.any(Error)
    );
  });

  it('logs a failed sport settings write by name', () => {
    const client = openClient();
    mockSettings.setSportSettings.mockImplementation(() => {
      throw new Error('database is locked');
    });

    client.setSportSettings('[]');

    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('setSportSettings'),
      expect.any(Error)
    );
  });

  it('reports whether a recomputation request applied and logs a failure', () => {
    const client = openClient();
    expect(client.markForRecomputation()).toBe(true);

    mockNativeEngine.markForRecomputation.mockImplementation(() => {
      throw new Error('cleared');
    });
    expect(client.markForRecomputation()).toBe(false);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.stringContaining('markForRecomputation'),
      expect.any(Error)
    );
  });
});
