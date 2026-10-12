/**
 * Scenario: the athlete taps "Review" on the home support card on a phone where
 * neither the store app nor a browser opens.
 *
 * Expected behaviour: the card does not count the tap as a review, so it is not
 * hidden for the interval a real review earns. A store that opens does count.
 */

import React from 'react';
import { Linking } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { SupportCard } from '@/features/home/components/SupportCard';

const mockRecordAction = jest.fn();

jest.mock('react-native-iap', () => ({
  useIAP: () => ({
    connected: false,
    products: [],
    fetchProducts: jest.fn(),
    requestPurchase: jest.fn(),
    finishTransaction: jest.fn(),
  }),
  ErrorCode: { UserCancelled: 'user-cancelled' },
}));

jest.mock('@/shared/app/SupportStore', () => ({
  useSupportStore: (selector: (s: unknown) => unknown) =>
    selector({
      isLoaded: true,
      shouldShow: () => true,
      neverShowAgain: jest.fn(),
      remindLater: jest.fn(),
      recordAction: mockRecordAction,
    }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openBrowserAsync: jest.fn(),
}));

const openBrowserAsync = WebBrowser.openBrowserAsync as jest.Mock;
let openURL: jest.SpyInstance;

beforeEach(() => {
  mockRecordAction.mockReset();
  openBrowserAsync.mockReset();
  openURL = jest.spyOn(Linking, 'openURL');
});

afterEach(() => {
  openURL.mockRestore();
});

describe('SupportCard review', () => {
  it('does not record an action when nothing opens', async () => {
    openURL.mockRejectedValue(new Error('No Activity found to handle Intent'));
    openBrowserAsync.mockRejectedValue(new Error('No browser'));

    render(<SupportCard />);
    fireEvent.press(screen.getByText('support.review'));

    await waitFor(() => expect(openBrowserAsync).toHaveBeenCalled());
    await Promise.resolve();
    expect(mockRecordAction).not.toHaveBeenCalled();
  });

  it('records an action once the store opens', async () => {
    openURL.mockResolvedValue(true);

    render(<SupportCard />);
    fireEvent.press(screen.getByText('support.review'));

    await waitFor(() => expect(mockRecordAction).toHaveBeenCalledTimes(1));
  });
});
