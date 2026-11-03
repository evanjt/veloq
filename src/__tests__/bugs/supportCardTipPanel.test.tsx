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
import { Platform, StyleSheet } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { SupportCard } from '@/features/home/components/SupportCard';
import { openLaunchSession } from '../__shared__/launchSession';

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

// The sponsor button is the probe for an open panel, and it is offered only off iOS.
const originalOS = Platform.OS;

beforeEach(() => {
  openLaunchSession();
  Platform.OS = 'android';
});

afterEach(() => {
  Platform.OS = originalOS;
});

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

describe('support card actions at a narrow width', () => {
  const WORD_WIDTH = 60;

  async function layoutOf(rowWidth: number) {
    await render(<SupportCard />);
    const row = screen.getByTestId('support-card-actions');
    for (const word of screen.getAllByTestId(/^support-card-actions-word-/, {
      includeHiddenElements: true,
    })) {
      await fireEvent(word, 'layout', {
        nativeEvent: { layout: { width: WORD_WIDTH, height: 20 } },
      });
    }
    await fireEvent(row, 'layout', { nativeEvent: { layout: { width: rowWidth, height: 40 } } });
    return StyleSheet.flatten(screen.getByTestId('support-card-actions').props.style);
  }

  it('stacks the three actions when a third of the row cannot hold a word', async () => {
    expect((await layoutOf(240)).flexDirection).toBeUndefined();
  });

  it('sets them side by side when every share holds its word', async () => {
    expect((await layoutOf(600)).flexDirection).toBe('row');
  });
});
