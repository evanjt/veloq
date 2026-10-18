/**
 * Scenario: the store has no tips to sell (still connecting, a sandbox with no
 * products, a review device), and the feed's support card and the Settings
 * support section fell back to a link that pays the developer outside the store.
 *
 * Expected behaviour: on iOS neither surface offers any way to pay outside the
 * App Store, and the tip controls that would lead only there are gone; the
 * store's own tips still render when it has products. Off iOS the outside link
 * stays the fallback.
 */

import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { SupportCard } from '@/features/home/components/SupportCard';
import { SupportSection } from '@/features/settings/components/SupportSection';
import { GITHUB_SPONSORS_URL } from '@/shared/app/supportLinks';
import { openLaunchSession } from '../__shared__/launchSession';

const store: { connected: boolean; products: { id: string; displayPrice: string }[] } = {
  connected: false,
  products: [],
};

jest.mock('react-native-iap', () => ({
  useIAP: () => ({
    connected: store.connected,
    products: store.products,
    fetchProducts: jest.fn(async () => undefined),
    requestPurchase: jest.fn(),
    finishTransaction: jest.fn(),
  }),
  getAvailablePurchases: jest.fn(async () => []),
  ErrorCode: { UserCancelled: 'user-cancelled' },
}));

jest.mock('@/shared/app/SupportStore', () => ({
  useSupportStore: (selector: (s: unknown) => unknown) =>
    selector({
      isLoaded: true,
      shouldShow: () => true,
      neverShowAgain: jest.fn(),
      remindLater: jest.fn(),
      recordAction: jest.fn(),
    }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openBrowserAsync: jest.fn(async () => undefined),
}));

const openBrowserAsync = WebBrowser.openBrowserAsync as jest.Mock;
const originalOS = Platform.OS;

const TIPS = [
  { id: 'tip_small', displayPrice: '$1.99' },
  { id: 'tip_medium', displayPrice: '$4.99' },
  { id: 'tip_large', displayPrice: '$9.99' },
];

beforeEach(() => {
  openLaunchSession();
  openBrowserAsync.mockClear();
  store.connected = false;
  store.products = [];
});

afterEach(() => {
  Platform.OS = originalOS;
});

/** Opens the card's tip panel when the card offers one. */
async function openCardPanel(): Promise<void> {
  const toggle = screen.queryByTestId('support-card-tip-toggle');
  if (toggle) await fireEvent.press(toggle);
}

describe('on iOS with no tips from the store', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
  });

  it('the support card offers no outside link and no empty tip panel', async () => {
    await render(<SupportCard />);
    await openCardPanel();

    expect(screen.getByTestId('support-card')).toBeTruthy();
    expect(screen.queryByTestId('support-card-tip-toggle')).toBeNull();
    expect(screen.queryByTestId('support-card-sponsor-button')).toBeNull();
    expect(screen.queryByText('support.sponsorGitHub')).toBeNull();
  });

  it('the Settings support section offers no outside link and no tip row', async () => {
    await render(<SupportSection />);

    expect(screen.getByTestId('support-section')).toBeTruthy();
    expect(screen.queryByTestId('support-sponsor-button')).toBeNull();
    expect(screen.queryByText('support.sponsorGitHub')).toBeNull();
    expect(screen.queryByText('support.tipTitle')).toBeNull();
    expect(openBrowserAsync).not.toHaveBeenCalledWith(GITHUB_SPONSORS_URL);
  });
});

describe('on iOS with tips from the store', () => {
  beforeEach(() => {
    Platform.OS = 'ios';
    store.connected = true;
    store.products = TIPS;
  });

  it('the support card offers the store tips', async () => {
    await render(<SupportCard />);
    await fireEvent.press(screen.getByTestId('support-card-tip-toggle'));

    expect(screen.getByTestId('support-card-tip-buttons')).toBeTruthy();
    expect(screen.getByText('$4.99')).toBeTruthy();
    expect(screen.queryByTestId('support-card-sponsor-button')).toBeNull();
  });

  it('the Settings support section offers the store tips', async () => {
    await render(<SupportSection />);

    expect(screen.getByText('support.tipTitle')).toBeTruthy();
    expect(screen.getByTestId('support-tip-buttons')).toBeTruthy();
    expect(screen.getByText('$9.99')).toBeTruthy();
    expect(screen.queryByTestId('support-sponsor-button')).toBeNull();
  });
});

describe('on Android with no tips from the store', () => {
  beforeEach(() => {
    Platform.OS = 'android';
  });

  it('the support card falls back to the outside link', async () => {
    await render(<SupportCard />);
    await fireEvent.press(screen.getByTestId('support-card-tip-toggle'));
    await fireEvent.press(screen.getByTestId('support-card-sponsor-button'));

    expect(openBrowserAsync).toHaveBeenCalledWith(GITHUB_SPONSORS_URL);
  });

  it('the Settings support section falls back to the outside link', async () => {
    await render(<SupportSection />);
    await fireEvent.press(screen.getByTestId('support-sponsor-button'));

    expect(openBrowserAsync).toHaveBeenCalledWith(GITHUB_SPONSORS_URL);
  });
});
