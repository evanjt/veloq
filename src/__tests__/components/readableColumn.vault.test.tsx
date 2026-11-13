/**
 * Scenario: on a tablet window, 1366 wide, every screen was one column the full window width, so
 * cards and rows reached across the display and a row's label sat far from its value. The tab
 * pager sized its pages from the window, so a pager inside a narrower host laid its pages out at
 * the window's width, and the tour card took the window's width less a margin.
 *
 * Expected behaviour: a screen's scroll content is at most `layout.maxContentWidth` wide and
 * centred, and a caller's own content style still applies. A horizontal scroll view is left
 * alone. A pager page takes its host's measured width. The tour card is capped the same way and
 * keeps its margin on a phone.
 */

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { ScreenScrollView, SwipeableTabs } from '@/shared/ui';
import { tourCardWidth } from '@/features/settings/lib/tourSlideFit';
import { layout, spacing } from '@/theme';

jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 1366, height: 1024, scale: 2, fontScale: 1 }),
}));

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  selectionAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const TABS = [
  { key: 'loom', label: 'Loom', icon: 'grid' as const },
  { key: 'spindle', label: 'Spindle', icon: 'circle-outline' as const },
];

function contentStyle(testID: string) {
  return StyleSheet.flatten(screen.getByTestId(testID).props.contentContainerStyle);
}

describe('the readable column', () => {
  it('caps and centres a screen scroll view in a wide window', async () => {
    await render(
      <ScreenScrollView testID="weaving-scroll">
        <Text>warp and weft</Text>
      </ScreenScrollView>
    );

    expect(contentStyle('weaving-scroll')).toMatchObject({
      maxWidth: layout.maxContentWidth,
      width: '100%',
      alignSelf: 'center',
    });
  });

  it('keeps the caller content style beside the cap', async () => {
    await render(
      <ScreenScrollView testID="weaving-scroll" contentContainerStyle={{ padding: spacing.md }}>
        <Text>warp and weft</Text>
      </ScreenScrollView>
    );

    expect(contentStyle('weaving-scroll')).toMatchObject({
      maxWidth: layout.maxContentWidth,
      padding: spacing.md,
    });
  });

  it('leaves a horizontal scroll view uncapped', async () => {
    await render(
      <ScreenScrollView testID="weaving-scroll" horizontal>
        <Text>warp and weft</Text>
      </ScreenScrollView>
    );

    expect(contentStyle('weaving-scroll')?.maxWidth).toBeUndefined();
  });

  it('sizes each pager page from its host rather than the window', async () => {
    await render(
      <SwipeableTabs tabs={TABS} activeTab="loom" onTabChange={jest.fn()} isDark={false}>
        <Text>threading</Text>
        <Text>spinning</Text>
      </SwipeableTabs>
    );
    await fireEvent(screen.getByTestId('swipeable-tabs'), 'layout', {
      nativeEvent: { layout: { x: 0, y: 0, width: 700, height: 900 } },
    });

    for (const key of ['loom', 'spindle']) {
      expect(
        StyleSheet.flatten(
          screen.getByTestId(`tab-page-${key}`, { includeHiddenElements: true }).props.style
        ).width
      ).toBe(700);
    }
  });

  it('caps the tour card in a wide window and keeps its margin on a phone', () => {
    expect(tourCardWidth(1366)).toBe(layout.maxContentWidth);
    expect(tourCardWidth(390)).toBe(390 - spacing.xl * 2);
    expect(tourCardWidth(layout.maxContentWidth + spacing.xl * 2)).toBe(layout.maxContentWidth);
  });
});
