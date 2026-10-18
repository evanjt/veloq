/**
 * Scenario: a first sign-in no longer opens the tour. The feed card offers it
 * after the quiet period, the athlete may decline it, and a tour may close with
 * the backup slide unanswered.
 *
 * Expected behaviour: the card offers the tour in a session after the quiet
 * period. Not now hides it until a later session, and a second Not now ends the
 * offer and marks the tour seen. A tour closed with the backup slide unanswered
 * brings the card back once, in a later session, opening the tour at that slide
 * only; after that nothing returns. A backup turned on in the tour owes nothing.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TourOfferCard } from '@/features/settings/components/TourOfferCard';
import { NO_TOUR_OFFER } from '@/features/settings/lib/tourOffer';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { setSetting } from '@/shared/storage';
import { openLaunchSession } from '../../__shared__/launchSession';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());
jest.mock('expo-constants', () => ({
  ...jest.requireActual('expo-constants'),
  __esModule: true,
  default: { expoConfig: { version: '0.4.0' } },
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/settings/lib/autobackup', () => ({
  isAutoBackupEnabled: () => false,
}));

async function laterSession(): Promise<void> {
  await act(async () => {
    openLaunchSession();
  });
}

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

async function closeTour(): Promise<void> {
  await act(async () => {
    await useWhatsNewStore.getState().dismissTour('0.4.0');
  });
}

beforeEach(() => {
  jest.mocked(setSetting).mockClear();
  openLaunchSession();
  useAuthStore.setState({ isAuthenticated: true, isDemoMode: false });
  useWhatsNewStore.setState({
    isLoaded: true,
    lastSeenVersion: null,
    tourState: null,
    launchModal: null,
    restoreOffer: null,
    tourOffer: NO_TOUR_OFFER,
  });
});

it('offers nothing on a first sign-in inside the quiet period', async () => {
  openLaunchSession(true);
  await render(<TourOfferCard />);
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
  expect(useWhatsNewStore.getState().tourState).toBeNull();
});

it('offers nothing in demo', async () => {
  useAuthStore.setState({ isDemoMode: true });
  await render(<TourOfferCard />);
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
});

it('offers the tour after the quiet period and opens the whole tour on Take the tour', async () => {
  await render(<TourOfferCard />);
  expect(screen.getByText('whatsNew.tourOfferTitle')).toBeTruthy();
  await press('tour-offer-open');
  expect(useWhatsNewStore.getState().tourState).toMatchObject({ mode: 'tutorial', only: null });
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
});

it('waits a session after Not now, and the second Not now ends the offer', async () => {
  await render(<TourOfferCard />);
  await press('tour-offer-dismiss');
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
  expect(useWhatsNewStore.getState().lastSeenVersion).toBeNull();

  await laterSession();
  expect(screen.getByTestId('tour-offer-card')).toBeTruthy();
  await press('tour-offer-dismiss');
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
  expect(setSetting).toHaveBeenCalledWith('veloq-whats-new-seen', '0.4.0');

  await laterSession();
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
});

it('brings the card back once for a backup slide the tour left unanswered', async () => {
  await render(<TourOfferCard />);
  await press('tour-offer-open');
  await closeTour();
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();

  await laterSession();
  expect(screen.getByText('whatsNew.setupLeftoverTitleOne')).toBeTruthy();
  await press('tour-offer-open');
  expect(useWhatsNewStore.getState().tourState).toMatchObject({
    mode: 'tutorial',
    only: ['backup'],
  });
  await closeTour();

  await laterSession();
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
});

it('ends the leftover card at Not now', async () => {
  await render(<TourOfferCard />);
  await press('tour-offer-open');
  await closeTour();
  await laterSession();
  await press('tour-offer-dismiss');
  await laterSession();
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
});

it('owes nothing when backup was turned on in the tour', async () => {
  await render(<TourOfferCard />);
  await press('tour-offer-open');
  await act(async () => {
    useWhatsNewStore.getState().answerSetup('backup', 'on');
  });
  await closeTour();
  await laterSession();
  expect(screen.queryByTestId('tour-offer-card')).toBeNull();
});
