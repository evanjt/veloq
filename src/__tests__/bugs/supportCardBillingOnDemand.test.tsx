/**
 * Scenario: the support card sits in the home feed and is hidden on most
 * launches, because the athlete has dismissed it or the store's own timer has
 * not come round. It called `useDonation` above the visibility check, so every
 * feed mount bound Play Billing or StoreKit and fetched the three products for a
 * card that then rendered nothing.
 *
 * Expected behaviour: the billing connection opens when the card is on screen,
 * and not before.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SupportCard } from '@/features/home/components/SupportCard';

/** Every time the billing hook was mounted, which is the cost being moved. */
const mockUseIAP = jest.fn();

jest.mock('react-native-iap', () => ({
  useIAP: (...args: unknown[]) => {
    mockUseIAP(...args);
    return {
      connected: false,
      products: [],
      fetchProducts: jest.fn(),
      requestPurchase: jest.fn(),
      finishTransaction: jest.fn(),
    };
  },
  ErrorCode: { UserCancelled: 'user-cancelled' },
}));

let mockShouldShow = false;

jest.mock('@/shared/app/SupportStore', () => ({
  useSupportStore: (selector: (s: unknown) => unknown) =>
    selector({
      isLoaded: true,
      shouldShow: () => mockShouldShow,
      neverShowAgain: jest.fn(),
      remindLater: jest.fn(),
      recordAction: jest.fn(),
    }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-web-browser', () => ({ openBrowserAsync: jest.fn() }));

beforeEach(() => {
  mockUseIAP.mockClear();
  mockShouldShow = false;
});

describe('the support card and the billing connection', () => {
  it('opens no billing connection on a launch where it does not show', () => {
    const { toJSON } = render(<SupportCard />);

    expect(toJSON()).toBeNull();
    expect(mockUseIAP).not.toHaveBeenCalled();
  });

  it('opens one once the store says the card should show', () => {
    mockShouldShow = true;

    const { getByTestId } = render(<SupportCard />);

    expect(getByTestId('support-card')).toBeTruthy();
    expect(mockUseIAP).toHaveBeenCalled();
  });
});
