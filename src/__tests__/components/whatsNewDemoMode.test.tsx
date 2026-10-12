/**
 * Scenario: an athlete taps Try Demo, then returns to the login screen and signs in for real.
 *
 * Expected behaviour: demo never opens the tour or marks it seen, so the first real
 * sign-in gets it.
 */
import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { WhatsNewModal } from '@/features/settings/components/whatsNew/WhatsNewModal';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { MapPreferencesProvider } from '@/features/settings/stores/MapPreferencesContext';
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

  it('stays closed in demo mode and opens after a real sign-in', async () => {
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: true });
    await render(
      <MapPreferencesProvider>
        <WhatsNewModal />
      </MapPreferencesProvider>
    );
    expect(useWhatsNewStore.getState().tourState).toBeNull();
    expect(useWhatsNewStore.getState().lastSeenVersion).toBeNull();

    await act(() => {
      useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    });
    expect(useWhatsNewStore.getState().tourState?.mode).toBe('tutorial');
  });

  it('keeps the tour navigation discoverable by role and text', async () => {
    useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
    await render(
      <MapPreferencesProvider>
        <WhatsNewModal />
      </MapPreferencesProvider>
    );

    for (const label of ['whatsNew.skipButton', 'whatsNew.nextButton']) {
      expect(screen.getByText(label)).toBeTruthy();
      expect(screen.getByRole('button', { name: label })).toBeTruthy();
    }

    await fireEvent.press(screen.getByText('whatsNew.skipButton'));
    expect(useWhatsNewStore.getState().tourState).toBeNull();
  });
});
