/**
 * Scenario: the feed mounts the series download card beside another card that
 * has something to ask.
 *
 * Expected behaviour: after the quiet period the series card shows alone, inside
 * it neither shows, and answering the series card does not bring the other card
 * up in its place before the next session.
 */

import React from 'react';
import { Text, View } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { useSessionAsk } from '@/features/settings/hooks/useLaunchSurfaces';
import { StreamConsentCard } from '@/features/settings/components/StreamConsentCard';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { openLaunchSession } from '../../__shared__/launchSession';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (select: (s: unknown) => unknown) =>
    select({ authMethod: 'oauth', isDemoMode: false, isAuthenticated: true }),
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

let mockAwaitingConsent = true;
jest.mock('@/features/settings/hooks/useStreamBackfill', () => ({
  useStreamBackfill: () => ({
    awaitingConsent: mockAwaitingConsent,
    estimateRequests: 1200,
    estimateMegabytes: 141,
    start: jest.fn(),
    stop: jest.fn(),
  }),
}));

/** A card later in the order that always has something to ask. */
function LaterCard() {
  return useSessionAsk('support', true) ? <Text>later-card</Text> : null;
}

function Feed() {
  return (
    <View>
      <StreamConsentCard />
      <LaterCard />
    </View>
  );
}

function laterCardShown(): boolean {
  return screen.queryByText('later-card') !== null;
}

beforeEach(() => {
  mockAwaitingConsent = true;
  useWhatsNewStore.setState({
    tourState: null,
    launchModal: null,
    restoreOffer: null,
    lastSeenVersion: '1.0.0',
    isLoaded: true,
  });
});

it('shows the series card alone after the quiet period where a later card is eligible too', async () => {
  openLaunchSession();
  await render(<Feed />);

  expect(screen.getByTestId('stream-consent-card')).toBeTruthy();
  expect(laterCardShown()).toBe(false);
  expect(useWhatsNewStore.getState().sessionAsk).toBe('seriesConsent');
});

it('shows neither card in the quiet period', async () => {
  openLaunchSession(true);
  await render(<Feed />);

  expect(screen.queryByTestId('stream-consent-card')).toBeNull();
  expect(laterCardShown()).toBe(false);
  expect(useWhatsNewStore.getState().sessionAsk).toBeNull();
});

it('brings no other card up once the series card is answered', async () => {
  openLaunchSession();
  await render(<Feed />);
  expect(screen.getByTestId('stream-consent-card')).toBeTruthy();

  mockAwaitingConsent = false;
  await screen.rerender(<Feed />);

  expect(screen.queryByTestId('stream-consent-card')).toBeNull();
  expect(laterCardShown()).toBe(false);
});

it('shows the later card after the quiet period with no series download waiting', async () => {
  mockAwaitingConsent = false;
  openLaunchSession();
  await render(<Feed />);

  expect(screen.queryByTestId('stream-consent-card')).toBeNull();
  expect(laterCardShown()).toBe(true);
});
