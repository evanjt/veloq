/**
 * Scenario: the engine rebuilt the library on a launch that would also open the
 * tour, either the first load's tutorial or What's New after an update.
 *
 * Expected behaviour: one modal per launch. A first load shows the tour and no
 * notice. After an update the notice goes first and What's New waits for the
 * next launch, where it opens.
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
  it('shows the tour alone on a first load with a rebuilt library', async () => {
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
    mockTake.mockReturnValue(rebuilt);
    captureQuarantineReport();
    await launch();

    expect(useWhatsNewStore.getState().tourState?.mode).toBe('tutorial');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('keeps the notice back when the library is rebuilt after the tour opened', async () => {
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
    await launch();
    expect(useWhatsNewStore.getState().tourState?.mode).toBe('tutorial');

    mockTake.mockReturnValueOnce(rebuilt);
    await act(async () => {
      captureQuarantineReport();
    });
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('raises the notice after an update and opens What’s New on the next launch', async () => {
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
    expect(useWhatsNewStore.getState().tourState?.mode).toBe('whatsNew');
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('keeps the first tour for the next launch when the notice took the slot before sign-in', async () => {
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
    expect(useWhatsNewStore.getState().lastSeenVersion).toBeNull();
    await first.unmount();

    await act(async () => {
      clearQuarantineReport();
    });
    useWhatsNewStore.setState({ launchModal: null });
    await launch();
    expect(useWhatsNewStore.getState().tourState?.mode).toBe('tutorial');
  });
});
