/**
 * Scenario: the debug store is initialised at launch and again after every restore.
 * Expected behaviour: one store listener stays wired however often it is initialised,
 * so a toggle reaches the engine once.
 */
import { initializeDebugStore, useDebugStore } from '@/features/settings/stores/DebugStore';

const mockSetDebugEnabled = jest.fn();

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    EngineClient: {
      setMetricRecorder: jest.fn(),
      setDebugEnabled: (...args: unknown[]) => mockSetDebugEnabled(...args),
    },
  })
);

describe('initializeDebugStore', () => {
  beforeEach(() => {
    mockSetDebugEnabled.mockClear();
  });

  it('forwards a toggle once after repeated initialisation', async () => {
    await initializeDebugStore();
    await initializeDebugStore();
    await initializeDebugStore();
    mockSetDebugEnabled.mockClear();

    await useDebugStore.getState().setEnabled(true);

    expect(mockSetDebugEnabled).toHaveBeenCalledTimes(1);
    expect(mockSetDebugEnabled).toHaveBeenCalledWith(true);
  });
});
