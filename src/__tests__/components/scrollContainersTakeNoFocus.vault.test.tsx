/**
 * Scenario: on Android a scroll view is a focusable view, so with a keyboard Tab stops on each
 * page scroller and each chip strip, which has nothing to say, and the presses run out before
 * Tab reaches the record button or the tab bar.
 *
 * Expected behaviour: the scroll containers that hold controls take no focus of their own, so
 * Tab moves from control to control.
 */

import React from 'react';
import { Text } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { ScreenScrollView, SwipeableTabs } from '@/shared/ui';
import { SportChipRow } from '@/shared/ui/SportChipRow';

const TABS = [
  { key: 'one', label: 'Alpha', icon: 'lightbulb-outline' as const },
  { key: 'two', label: 'Beta', icon: 'dumbbell' as const },
];

describe('scroll containers and keyboard focus', () => {
  it('ScreenScrollView takes no focus', async () => {
    const { getByTestId } = await render(
      <ScreenScrollView testID="page">
        <Text>row</Text>
      </ScreenScrollView>
    );
    expect(getByTestId('page').props.focusable).toBe(false);
  });

  it('the scrolling tab strip takes no focus', async () => {
    const { getByTestId } = await render(
      <SwipeableTabs tabs={TABS} activeTab="one" onTabChange={jest.fn()} isDark={false}>
        {TABS.map((tab) => (
          <React.Fragment key={tab.key} />
        ))}
      </SwipeableTabs>
    );
    const layout = (width: number) => ({
      nativeEvent: { layout: { x: 0, y: 0, width, height: 20 } },
    });
    await act(async () => {
      await fireEvent(getByTestId('swipeable-tabs'), 'layout', layout(300));
    });
    for (const [i, tab] of TABS.entries()) {
      await act(async () => {
        await fireEvent(
          getByTestId(`tab-measure-${tab.key}`, { includeHiddenElements: true }),
          'layout',
          layout(i === 0 ? 100 : 400)
        );
      });
    }
    expect(getByTestId('tab-strip-scroll').props.focusable).toBe(false);
  });

  it('the sport chip row takes no focus', async () => {
    const { UNSAFE_getByType } = await render(
      <SportChipRow chips={[{ key: 'ride', label: 'Ride' }]} value="ride" onSelect={jest.fn()} />
    );
    const { ScrollView } = require('react-native');
    expect(UNSAFE_getByType(ScrollView).props.focusable).toBe(false);
  });
});
