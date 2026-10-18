/**
 * Scenario: a label wider than its equal share of the strip ended in an
 * ellipsis, so on a narrow phone in a long locale the tab could not be read.
 * A tab measured in the visible row reports the width it was squeezed to, and
 * the selected tab's heavier weight made a borderline strip flip between
 * equal shares and scrolling as the selection moved.
 *
 * Expected behaviour: each tab is measured in a hidden row nothing constrains,
 * at the selected weight. While every tab fits its share the tabs stay equal;
 * once one does not, the strip scrolls with each tab sized to its measured
 * width, the indicator takes the active tab's width, and no label is truncated.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { advanceAnimationByTime, getAnimatedStyle } from '../__shared__/reanimatedJest';

import { SwipeableTabs } from '@/shared/ui';
import { spacing, typography } from '@/theme';

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
// The measuring row is hidden from screen readers, which the default queries skip.
const HIDDEN = { includeHiddenElements: true };

type Tab = {
  key: string;
  label: string;
  icon: 'lightbulb-outline' | 'dumbbell' | 'map-marker-path';
};

function strip(tabs: Tab[], activeTab: string) {
  return (
    <SwipeableTabs tabs={tabs} activeTab={activeTab} onTabChange={jest.fn()} isDark={false}>
      {tabs.map((tab) => (
        <React.Fragment key={tab.key} />
      ))}
    </SwipeableTabs>
  );
}

function layoutEvent(width: number) {
  return { nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } } };
}

async function renderStrip(activeTab = 'one', tabs: Tab[] = TABS) {
  const utils = await render(strip(tabs, activeTab));
  const measure = async (widths: number[]) => {
    for (const [i, width] of widths.entries()) {
      await act(async () => {
        await fireEvent(
          utils.getByTestId(`tab-measure-${tabs[i].key}`, HIDDEN),
          'layout',
          layoutEvent(width)
        );
      });
    }
  };
  const hostWidth = async (width: number) => {
    await act(async () => {
      await fireEvent(utils.getByTestId('swipeable-tabs'), 'layout', layoutEvent(width));
    });
  };
  return { ...utils, measure, hostWidth };
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
    const { measure, getByTestId } = await renderStrip();

    await measure([60, AVAILABLE, 60]);

    const label = within(getByTestId('tab-two')).getByText('Beta');
    expect(label.props.ellipsizeMode).toBeUndefined();
    expect(label.props.numberOfLines).toBe(1);
    expect(StyleSheet.flatten(label.props.style).flexShrink).not.toBe(1);
  });

  it('measures every tab at the selected weight, whichever tab is selected', async () => {
    const { getByTestId, rerender } = await renderStrip('one');
    const measuredWeights = () =>
      TABS.map(
        (tab) =>
          StyleSheet.flatten(
            within(getByTestId(`tab-measure-${tab.key}`, HIDDEN)).getByText(tab.label, HIDDEN).props
              .style
          ).fontWeight
      );

    const whenFirst = measuredWeights();
    await rerender(strip(TABS, 'two'));

    expect(whenFirst).toStrictEqual(TABS.map(() => typography.bodySmallBold.fontWeight));
    expect(measuredWeights()).toStrictEqual(whenFirst);
  });

  it('keeps a borderline strip in the same layout when the selection moves', async () => {
    const { measure, queryByTestId, rerender } = await renderStrip('one');

    await measure([AVAILABLE / TABS.length - PADDING, 60, 60]);
    const before = queryByTestId('tab-strip-scroll');
    await rerender(strip(TABS, 'two'));

    expect(before).toBeNull();
    expect(queryByTestId('tab-strip-scroll')).toBeNull();
  });

  it('hides the measuring row from touch and from screen readers', async () => {
    const { getByTestId } = await renderStrip();

    const row = getByTestId('tab-measure-row', HIDDEN);

    expect(row.props.pointerEvents).toBe('none');
    expect(row.props.importantForAccessibility).toBe('no-hide-descendants');
    expect(row.props.accessibilityElementsHidden).toBe(true);
    expect(StyleSheet.flatten(row.props.style).opacity).toBe(0);
  });

  it.each([1.3, 2])(
    'gives every long label at least its measured width on a 360 wide phone at %s times text',
    async (fontScale) => {
      const tabs: Tab[] = [
        { key: 'insights', label: 'Erkenntnisse', icon: 'lightbulb-outline' },
        { key: 'training', label: 'Trainingsbelastung', icon: 'dumbbell' },
        { key: 'routes', label: 'Streckenabschnitte', icon: 'map-marker-path' },
      ];
      // An icon and a label at about 7 points a character at 1x, scaled with the text.
      const natural = tabs.map((tab) => Math.round((20 + 4 + tab.label.length * 7) * fontScale));
      const { measure, hostWidth, getByTestId } = await renderStrip('insights', tabs);

      await hostWidth(360);
      await measure(natural);

      expect(getByTestId('tab-strip-scroll')).toBeTruthy();
      const short = tabs.flatMap((tab, i) => {
        const width = StyleSheet.flatten(getByTestId(`tab-${tab.key}`).props.style).width;
        return width >= natural[i] + PADDING ? [] : [`${tab.label} ${width}`];
      });
      expect(short).toStrictEqual([]);
      for (const tab of tabs) {
        const label = within(getByTestId(`tab-${tab.key}`)).getByText(tab.label);
        expect(label.props.ellipsizeMode).toBeUndefined();
        expect(StyleSheet.flatten(label.props.style).flexShrink).not.toBe(1);
      }
    }
  );

  it('fades the trailing edge of a scrolling strip into the page', async () => {
    const { measure, queryByTestId } = await renderStrip();

    expect(queryByTestId('tab-strip-fade')).toBeNull();
    await measure([60, AVAILABLE, 60]);

    expect(queryByTestId('tab-strip-fade')).toBeTruthy();
  });
});
