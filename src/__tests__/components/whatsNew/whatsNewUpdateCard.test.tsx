/**
 * Scenario: the athlete updates from 0.4.0 to 0.4.1, which added one slide.
 *
 * Expected behaviour: no tour opens on its own. The feed card names 0.4.1 and the
 * one slide; Open runs the What's New tour, and the dismiss marks 0.4.1 seen so
 * the card is gone and not offered again for that version.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { WhatsNewCard } from '@/features/settings/components/WhatsNewCard';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { setSetting } from '@/shared/storage';
import { openLaunchSession } from '../../__shared__/launchSession';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  __esModule: true,
  default: { expoConfig: { version: '0.4.1' } },
}));
jest.mock('@/features/settings/components/whatsNew/slides', () => ({
  ...jest.requireActual('@/features/settings/components/whatsNew/slides'),
  getSlidesSince: (version: string) => (version === '0.4.0' ? [{ version: '0.4.1' }] : []),
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

beforeEach(() => {
  jest.mocked(setSetting).mockClear();
  openLaunchSession();
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  useWhatsNewStore.setState({
    isLoaded: true,
    lastSeenVersion: '0.4.0',
    tourState: null,
    launchModal: null,
    restoreOffer: null,
  });
});

it('names the version and the slide count, and opens no tour on its own', async () => {
  await render(<WhatsNewCard />);
  expect(screen.getByTestId('whats-new-update-card')).toBeTruthy();
  expect(screen.getByText(/whatsNew\.updateCardTitle.*0\.4\.1/)).toBeTruthy();
  expect(screen.getByText(/whatsNew\.updateCardBody.*1/)).toBeTruthy();
  expect(useWhatsNewStore.getState().tourState).toBeNull();
});

it('runs the What’s New tour on Open, and hides while it runs', async () => {
  await render(<WhatsNewCard />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('whats-new-update-open'));
  });
  expect(useWhatsNewStore.getState().tourState?.mode).toBe('whatsNew');
  expect(screen.queryByTestId('whats-new-update-card')).toBeNull();
});

it('marks the running version seen on dismiss and is not offered again', async () => {
  await render(<WhatsNewCard />);
  await act(async () => {
    fireEvent.press(screen.getByTestId('whats-new-update-dismiss'));
  });
  expect(setSetting).toHaveBeenCalledWith('veloq-whats-new-seen', '0.4.1');
  expect(useWhatsNewStore.getState().lastSeenVersion).toBe('0.4.1');
  expect(screen.queryByTestId('whats-new-update-card')).toBeNull();
});

it('shows nothing in a first session', async () => {
  openLaunchSession(true);
  await render(<WhatsNewCard />);
  expect(screen.queryByTestId('whats-new-update-card')).toBeNull();
});
