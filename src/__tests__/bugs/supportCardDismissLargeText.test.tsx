/**
 * Scenario: the support card closes with a centred row of two text buttons
 * split by a dot. At the largest text sizes the row cannot wrap, so both
 * labels run off the card's edges and neither can be read or reached.
 *
 * Expected behaviour: past the large-text cap the two buttons stack in a
 * column with no separator, and at default text the row is unchanged.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SupportCard } from '@/features/home/components/SupportCard';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

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
      recordAction: jest.fn(),
    }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 320, height: 640, scale: 3, fontScale: mockFontScale }),
}));

/** The nearest view above both nodes, and the direction it lays them out in. */
function sharedDirection(a: ReactTestInstance, b: ReactTestInstance): string | undefined {
  const above = new Set<ReactTestInstance>();
  for (let n: ReactTestInstance | null = a; n; n = n.parent) above.add(n);
  for (let n: ReactTestInstance | null = b; n; n = n.parent) {
    if (above.has(n) && n.props.style !== undefined) {
      return StyleSheet.flatten(n.props.style)?.flexDirection ?? 'column';
    }
  }
  return undefined;
}

function dismissButtons() {
  return [screen.getByText('support.remindLater'), screen.getByText('support.neverShow')] as const;
}

describe('the support card dismiss row', () => {
  afterEach(() => {
    mockFontScale = 1;
  });

  it('keeps the two buttons on one row with a separator at default text', async () => {
    await render(<SupportCard />);

    const [later, never] = dismissButtons();
    expect(sharedDirection(later, never)).toBe('row');
    expect(screen.queryByText('·')).not.toBeNull();
  });

  it('stacks the two buttons and drops the separator past the large-text cap', async () => {
    mockFontScale = 2;
    await render(<SupportCard />);

    const [later, never] = dismissButtons();
    expect(sharedDirection(later, never)).toBe('column');
    expect(screen.queryByText('·')).toBeNull();
  });
});
