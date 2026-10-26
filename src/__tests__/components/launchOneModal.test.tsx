/**
 * Scenario: the engine rebuilt the library on a first load, or on a launch after
 * an update with What's New to show.
 *
 * Expected behaviour: one modal per launch, and it is the notice. No tour opens
 * on its own: the first-run tour and What's New are both offered by feed cards,
 * so the tour stays unseen until the athlete answers one.
 */
import React from 'react';
import { Alert } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { LibraryRebuiltNotice } from '@/features/settings/components/LibraryRebuiltNotice';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import { MapPreferencesProvider } from '@/features/settings/stores/MapPreferencesContext';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import {
  captureQuarantineReport,
  clearQuarantineReport,
} from '@/features/settings/lib/quarantineReport';
import { useAuthStore } from '@/shared/app/AuthStore';

const mockTake = jest.fn();
jest.mock('@/features/settings/hooks/useGarminOffer', () => ({ useUsesGarmin: () => false }));

jest.mock('@/shared/native/engine', () => {
  const actual = jest.requireActual('@/shared/native/engine');
  return {
    ...actual,
    getEngine: () => {
      const engine = actual.getEngine();
      return new Proxy(engine ?? {}, {
        get: (target, key) =>
          key === 'takeQuarantineReport' ? () => mockTake() : Reflect.get(target, key),
      });
    },
    getRouteDbPath: () => null,
  };
});
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/components/whatsNew/WhatsNewSlide', () => ({
  WhatsNewSlide: () => null,
}));

const rebuilt = {
  history: 0,
  geometry: 0,
  pins: 0,
  sections: 3,
  intents: 0,
  recordings: 0,
  routeNames: 0,
};

let alertSpy: jest.SpyInstance;

function launch() {
  return render(
    <MapPreferencesProvider>
      <LibraryRebuiltNotice />
      <WhatsNewModal />
    </MapPreferencesProvider>
  );
}

beforeEach(() => {
  mockTake.mockReset().mockReturnValue(null);
  clearQuarantineReport();
  useWhatsNewStore.setState({ launchModal: null, restoreOffer: null });
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
});

afterEach(() => alertSpy.mockRestore());

describe('one modal per launch', () => {
  it('raises the notice and opens no tour on a first load with a rebuilt library', async () => {
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
    mockTake.mockReturnValue(rebuilt);
    captureQuarantineReport();
    await launch();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(useWhatsNewStore.getState().tourState).toBeNull();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBeNull();
  });

  it('raises the notice after an update and opens What’s New on no launch', async () => {
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: '0.0.1', tourState: null });
    mockTake.mockReturnValue(rebuilt);
    captureQuarantineReport();
    const first = await launch();

    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(useWhatsNewStore.getState().tourState).toBeNull();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBe('0.0.1');

    await act(async () => {
      clearQuarantineReport();
    });
    expect(useWhatsNewStore.getState().tourState).toBeNull();
    await first.unmount();

    useWhatsNewStore.setState({ launchModal: null, restoreOffer: null });
    await launch();
    expect(useWhatsNewStore.getState().tourState).toBeNull();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBe('0.0.1');
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('opens no tour on a first sign-in, before the notice is answered or after', async () => {
    useAuthStore.setState({ isAuthenticated: false, isDemoMode: false });
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
    mockTake.mockReturnValue(rebuilt);
    captureQuarantineReport();
    const first = await launch();
    expect(alertSpy).toHaveBeenCalledTimes(1);

    await act(async () => {
      useAuthStore.setState({ isAuthenticated: true });
    });
    expect(useWhatsNewStore.getState().tourState).toBeNull();
    await first.unmount();

    await act(async () => {
      clearQuarantineReport();
    });
    useWhatsNewStore.setState({ launchModal: null });
    await launch();
    expect(useWhatsNewStore.getState().tourState).toBeNull();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBeNull();
  });
});
