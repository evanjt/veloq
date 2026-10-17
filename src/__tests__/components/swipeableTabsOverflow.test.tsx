/**
 * Scenario: a label wider than its equal share of the strip ended in an
 * ellipsis, so on a narrow phone in a long locale the tab could not be read.
 *
 * Expected behaviour: while every label fits its share the tabs stay equal;
 * once one does not, the strip scrolls with each tab sized to its content, the
 * indicator takes the active tab's measured width, and no label is truncated.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { advanceAnimationByTime, getAnimatedStyle } from '../__shared__/reanimatedJest';

import { SwipeableTabs } from '@/shared/ui';
import { spacing } from '@/theme';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const TABS = [
  { key: 'one', label: 'Alpha', icon: 'lightbulb-outline' as const },
  { key: 'two', label: 'Beta', icon: 'dumbbell' as const },
  { key: 'three', label: 'Gamma', icon: 'map-marker-path' as const },
];

// The window is 750 wide under Jest, so the strip has 750 - 2 * spacing.md to share.
const AVAILABLE = 750 - spacing.md * 2;
const PADDING = spacing.sm * 2;

async function renderStrip(activeTab = 'one') {
  const utils = await render(
    <SwipeableTabs tabs={TABS} activeTab={activeTab} onTabChange={jest.fn()} isDark={false}>
      {TABS.map((tab) => (
        <React.Fragment key={tab.key} />
      ))}
    </SwipeableTabs>
  );
  const measure = async (widths: number[]) => {
    for (const [i, width] of widths.entries()) {
      await act(async () => {
        await fireEvent(utils.getByTestId(`tab-content-${TABS[i].key}`), 'layout', {
          nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } },
        });
      });
    }
  };
  return { ...utils, measure };
}

describe('the tab strip when labels are measured', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  it('keeps equal tabs and no scroller while every label fits its share', async () => {
    const { measure, queryByTestId, getByTestId } = await renderStrip();

    await measure([60, 50, 60]);

    expect(queryByTestId('tab-strip-scroll')).toBeNull();
    expect(StyleSheet.flatten(getByTestId('tab-one').props.style).flex).toBe(1);
  });

  it('scrolls, with tabs sized to their labels, when one label is wider than its share', async () => {
    const { measure, getByTestId } = await renderStrip();
    const wide = AVAILABLE / TABS.length + 40;

    await measure([60, wide, 60]);

    expect(getByTestId('tab-strip-scroll')).toBeTruthy();
    expect(StyleSheet.flatten(getByTestId('tab-two').props.style).width).toBe(wide + PADDING);
    expect(StyleSheet.flatten(getByTestId('tab-one').props.style).width).toBe(60 + PADDING);
  });

  it('gives the indicator the active tab width in the scrolling strip', async () => {
    const { measure, getByTestId } = await renderStrip('two');
    const wide = AVAILABLE / TABS.length + 40;

    await measure([60, wide, 60]);
    await act(() => advanceAnimationByTime(300));

    expect(StyleSheet.flatten(getAnimatedStyle(getByTestId('tab-indicator')))?.width).toBe(
      wide + PADDING
    );
  });

  it('never limits a label to a line that can cut it off', async () => {
    const { measure, getByText } = await renderStrip();

    await measure([60, AVAILABLE, 60]);

    expect(getByText('Beta').props.ellipsizeMode).toBeUndefined();
    expect(getByText('Beta').props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(getByText('Beta').props.style).flexShrink).not.toBe(1);
  });
});
