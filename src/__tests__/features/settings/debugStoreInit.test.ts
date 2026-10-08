/**
 * Scenario: the debug store is initialised at launch and again after every restore.
 * Expected behaviour: one store listener stays wired however often it is initialised,
 * so a toggle reaches the engine once.
 */
import { initialiseDebugStore, useDebugStore } from '@/features/settings/stores/DebugStore';
import AsyncStorage from '@react-native-async-storage/async-storage';

const mockSetDebugEnabled = jest.fn();

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    EngineClient: {
      setMetricRecorder: jest.fn(),
      setDebugEnabled: (...args: unknown[]) => mockSetDebugEnabled(...args),
    },
  })
);

describe('initialiseDebugStore', () => {
  beforeEach(() => {
    mockSetDebugEnabled.mockClear();
    useDebugStore.setState({ unlocked: false, enabled: false, isLoaded: false });
    return AsyncStorage.clear();
  });

  it('forwards a toggle once after repeated initialisation', async () => {
    await initialiseDebugStore();
    await initialiseDebugStore();
    await initialiseDebugStore();
    mockSetDebugEnabled.mockClear();

    await useDebugStore.getState().setEnabled(true);

    expect(mockSetDebugEnabled).toHaveBeenCalledTimes(1);
    expect(mockSetDebugEnabled).toHaveBeenCalledWith(true);
  });

  it('restores an enabled switch at launch and lowers the level when turned off', async () => {
    await AsyncStorage.setItem('veloq-debug-mode', JSON.stringify({ enabled: true }));

    await initialiseDebugStore();
    expect(mockSetDebugEnabled).toHaveBeenCalledWith(true);

    mockSetDebugEnabled.mockClear();
    await useDebugStore.getState().setEnabled(false);
    expect(mockSetDebugEnabled).toHaveBeenCalledTimes(1);
    expect(mockSetDebugEnabled).toHaveBeenCalledWith(false);
  });
});
