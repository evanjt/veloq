import { act, renderHook, waitFor } from '@testing-library/react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { StartOutcome } from 'veloqrs';

import {
  LEGACY_SECTION_HEALTH_CHECK_KEY,
  SECTION_HEALTH_CHECK_SETTING,
  useSectionHealthCheck,
} from '@/features/routes/hooks/useSectionHealthCheck';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  isRouteMatchingEnabled: () => true,
}));

const mockedGetEngine = getEngine as jest.MockedFunction<typeof getEngine>;

const settings = new Map<string, string>();

function engineWith(outcome: StartOutcome) {
  return {
    getSetting: jest.fn((key: string) => settings.get(key)),
    setSetting: jest.fn((key: string, value: string) => void settings.set(key, value)),
    getActivityCount: jest.fn(() => 1),
    getSectionCount: jest.fn(() => 0),
    isCutoverPending: jest.fn(() => false),
    isCutoverRunning: jest.fn(() => false),
    forceRedetectSections: jest.fn(() => outcome),
  };
}

describe('section health check redetect', () => {
  beforeEach(async () => {
    jest.clearAllMocks();
    settings.clear();
    await AsyncStorage.clear();
  });

  it.each([
    StartOutcome.Held,
    StartOutcome.Busy,
    StartOutcome.NotReady,
    StartOutcome.NotConfigured,
    StartOutcome.NotOwed,
    StartOutcome.Failed,
    StartOutcome.Offline,
  ])('retries on a later launch after refusal %s', async (refusal) => {
    const refusedEngine = engineWith(refusal);
    mockedGetEngine.mockReturnValue(refusedEngine as never);

    const firstLaunch = renderHook(() => useSectionHealthCheck(true));
    await waitFor(() => expect(refusedEngine.forceRedetectSections).toHaveBeenCalledTimes(1));
    await act(async () => {});
    expect(settings.get(SECTION_HEALTH_CHECK_SETTING)).toBeUndefined();
    firstLaunch.unmount();

    const acceptedEngine = engineWith(StartOutcome.Started);
    mockedGetEngine.mockReturnValue(acceptedEngine as never);
    renderHook(() => useSectionHealthCheck(true));
    await waitFor(() => expect(acceptedEngine.forceRedetectSections).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(settings.get(SECTION_HEALTH_CHECK_SETTING)).toBe('1'));
  });

  it('runs again on a library whose engine stamp a wipe removed', async () => {
    const engine = engineWith(StartOutcome.Started);
    mockedGetEngine.mockReturnValue(engine as never);

    const first = renderHook(() => useSectionHealthCheck(true));
    await waitFor(() => expect(engine.forceRedetectSections).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(settings.get(SECTION_HEALTH_CHECK_SETTING)).toBe('1'));
    first.unmount();

    settings.clear();
    renderHook(() => useSectionHealthCheck(true));
    await waitFor(() => expect(engine.forceRedetectSections).toHaveBeenCalledTimes(2));
  });

  it('does not run again while the engine stamp stands', async () => {
    settings.set(SECTION_HEALTH_CHECK_SETTING, '1');
    const engine = engineWith(StartOutcome.Started);
    mockedGetEngine.mockReturnValue(engine as never);

    renderHook(() => useSectionHealthCheck(true));
    await act(async () => {});

    expect(engine.forceRedetectSections).not.toHaveBeenCalled();
  });

  it('carries a spent AsyncStorage stamp into the engine once and removes it', async () => {
    await AsyncStorage.setItem(LEGACY_SECTION_HEALTH_CHECK_KEY, 'done');
    const engine = engineWith(StartOutcome.Started);
    mockedGetEngine.mockReturnValue(engine as never);

    renderHook(() => useSectionHealthCheck(true));
    await waitFor(() => expect(settings.get(SECTION_HEALTH_CHECK_SETTING)).toBe('1'));

    expect(engine.forceRedetectSections).not.toHaveBeenCalled();
    expect(await AsyncStorage.getItem(LEGACY_SECTION_HEALTH_CHECK_KEY)).toBeNull();
  });
});
