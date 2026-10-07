/**
 * Scenario: an athlete taps Try Demo, then returns to the login screen and signs in for real.
 *
 * Expected behaviour: demo never opens the tour or marks it seen, so the first real
 * sign-in gets it.
 */
import React from 'react';
import { act, render } from '@testing-library/react-native';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { MapPreferencesProvider } from '@/features/maps/stores/MapPreferencesContext';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('@/features/settings/components/whatsNew/WhatsNewSlide', () => ({
  WhatsNewSlide: () => null,
}));

describe('WhatsNewModal auto-open', () => {
  beforeEach(() => {
    useWhatsNewStore.setState({ isLoaded: true, lastSeenVersion: null, tourState: null });
  });

  it('stays closed in demo mode and opens after a real sign-in', () => {
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: true });
    render(
      <MapPreferencesProvider>
        <WhatsNewModal />
      </MapPreferencesProvider>
    );
    expect(useWhatsNewStore.getState().tourState).toBeNull();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBeNull();

    act(() => {
      useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    });
    expect(useWhatsNewStore.getState().tourState?.mode).toBe('tutorial');
  });
});
