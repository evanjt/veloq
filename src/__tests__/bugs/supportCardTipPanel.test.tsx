/**
 * Scenario: the support card's "support development" panel is collapsed until
 * the athlete opens it. It stayed mounted at zero height and zero opacity, so a
 * screen reader still reached purchase buttons nobody could see, and opening it
 * animated to a fixed height that cut the buttons off once text grew.
 *
 * Expected behaviour: a collapsed panel exposes no tip or sponsor button, and an
 * open one carries no fixed height, so it is as tall as its content.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SupportCard } from '@/features/home/components/SupportCard';

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

jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openBrowserAsync: jest.fn(),
}));

/** Every fixed height between the button and the card's root. */
function fixedHeightsAbove(node: ReactTestInstance): number[] {
  const root = screen.getByTestId('support-card');
  const heights: number[] = [];
  let current: ReactTestInstance | null = node.parent;
  while (current && current !== root) {
    const style = StyleSheet.flatten(current.props.style);
    if (style && typeof style.height === 'number') heights.push(style.height);
    current = current.parent;
  }
  return heights;
}

describe('the support card tip panel', () => {
  it('exposes no purchase or sponsor button while collapsed', async () => {
    await render(<SupportCard />);

    expect(
      screen.queryByTestId('support-card-sponsor-button', { includeHiddenElements: false })
    ).toBeNull();
    expect(
      screen.queryByTestId('support-card-tip-buttons', { includeHiddenElements: false })
    ).toBeNull();
  });

  it('opens to the height of its content rather than a fixed one', async () => {
    await render(<SupportCard />);

    await fireEvent.press(screen.getByTestId('support-card-tip-toggle'));

    const sponsor = screen.getByTestId('support-card-sponsor-button', {
      includeHiddenElements: false,
    });
    expect(fixedHeightsAbove(sponsor)).toEqual([]);
  });

  it('hides the buttons again when closed a second time', async () => {
    await render(<SupportCard />);
    const toggle = screen.getByTestId('support-card-tip-toggle');

    await fireEvent.press(toggle);
    await fireEvent.press(toggle);

    expect(
      screen.queryByTestId('support-card-sponsor-button', { includeHiddenElements: false })
    ).toBeNull();
  });
});
