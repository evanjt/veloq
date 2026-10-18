/**
 * Scenario: a tab pager sits inside a form sheet. Android's sheet hands a vertical drag to the
 * first view, depth first, that scrolls nested, and the pager lays its pages side by side, so
 * with every page scrolling nested the first page took the hand-off whichever page was on show
 * and a drag on any other page moved the sheet instead of scrolling the page.
 *
 * Expected behaviour: only the page on show scrolls nested, the hand-off follows a change of
 * tab, and a scroller outside a pager still scrolls nested.
 */

import React from 'react';
import { Text } from 'react-native';
import { render } from '@testing-library/react-native';

import { SwipeableTabs } from '@/shared/ui';
import { usePagerPageScrollProps } from '@/shared/ui/pagerPageScroll';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
  ImpactFeedbackStyle: { Light: 'light' },
}));

const TABS = [
  { key: 'tide', label: 'Tide', icon: 'waves' as const },
  { key: 'swell', label: 'Swell', icon: 'chart-line' as const },
  { key: 'wind', label: 'Wind', icon: 'weather-windy' as const },
];

function Page({ name }: { name: string }) {
  const { nestedScrollEnabled } = usePagerPageScrollProps();
  return <Text testID={`page-${name}`}>{nestedScrollEnabled ? 'nested' : 'flat'}</Text>;
}

function pager(activeTab: string) {
  return (
    <SwipeableTabs tabs={TABS} activeTab={activeTab} onTabChange={jest.fn()} isDark={false}>
      {TABS.map((tab) => (
        <Page key={tab.key} name={tab.key} />
      ))}
    </SwipeableTabs>
  );
}

const handOff = (view: Awaited<ReturnType<typeof render>>) =>
  TABS.map(
    (tab) => view.getByTestId(`page-${tab.key}`, { includeHiddenElements: true }).props.children
  );

describe('a pager page inside a sheet', () => {
  it('scrolls nested on the page on show only', async () => {
    const view = await render(pager('swell'));
    expect(handOff(view)).toEqual(['flat', 'nested', 'flat']);
  });

  it('moves the hand-off to the page a change of tab shows', async () => {
    const view = await render(pager('tide'));
    expect(handOff(view)).toEqual(['nested', 'flat', 'flat']);

    await view.rerender(pager('wind'));
    expect(handOff(view)).toEqual(['flat', 'flat', 'nested']);
  });

  it('scrolls nested outside a pager', async () => {
    const view = await render(<Page name="alone" />);
    expect(view.getByTestId('page-alone').props.children).toBe('nested');
  });
});
