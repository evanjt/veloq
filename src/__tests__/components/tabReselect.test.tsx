/**
 * Scenario: the athlete is on a tab, scrolled down its list, and presses that tab again.
 *
 * Expected behaviour: the list goes back to where the tab opens, with no navigation and no
 * haptic. Pressing another tab navigates there and scrolls nothing.
 */

import React, { useRef } from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';
import { useScrollToTopOnReselect, type TabRoute } from '@/shared/ui/tabReselect';
import { navigateTab } from '@/shared/app/navigation';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

let mockPathname = '/';

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  usePathname: () => mockPathname,
  useSegments: () => ['(tabs)'],
}));

jest.mock('@/shared/app/navigation', () => ({ navigateTab: jest.fn() }));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: { isAuthenticated: boolean }) => unknown) =>
    selector({ isAuthenticated: true }),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

function FakeList({
  tab,
  list,
  offset,
}: {
  tab: TabRoute;
  list: { scrollToOffset: jest.Mock };
  offset?: number | (() => number);
}) {
  const ref = useRef(list);
  useScrollToTopOnReselect(tab, ref, offset);
  return null;
}

function FakeScrollView({ tab, view }: { tab: TabRoute; view: { scrollTo: jest.Mock } }) {
  const ref = useRef(view);
  useScrollToTopOnReselect(tab, ref);
  return null;
}

describe('tab reselect', () => {
  beforeEach(() => {
    mockPathname = '/';
    jest.clearAllMocks();
  });

  it('pressing the Feed tab on the Feed scrolls its list back to the opening offset', async () => {
    const feed = { scrollToOffset: jest.fn() };
    const { getByLabelText } = await render(
      <>
        <FakeList tab="/" list={feed} offset={() => 120} />
        <BottomTabBar />
      </>
    );

    await fireEvent.press(getByLabelText('navigation.feed'));

    expect(feed.scrollToOffset).toHaveBeenCalledTimes(1);
    expect(feed.scrollToOffset).toHaveBeenCalledWith({ offset: 120, animated: true });
    expect(navigateTab).not.toHaveBeenCalled();
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();
  });

  it('reads the offset at each press, so a measured offset is current', async () => {
    const feed = { scrollToOffset: jest.fn() };
    let measured = 96;
    const { getByLabelText } = await render(
      <>
        <FakeList tab="/" list={feed} offset={() => measured} />
        <BottomTabBar />
      </>
    );

    await fireEvent.press(getByLabelText('navigation.feed'));
    measured = 140;
    await fireEvent.press(getByLabelText('navigation.feed'));

    expect(feed.scrollToOffset.mock.calls).toEqual([
      [{ offset: 96, animated: true }],
      [{ offset: 140, animated: true }],
    ]);
  });

  it('pressing another tab navigates and scrolls nothing', async () => {
    const feed = { scrollToOffset: jest.fn() };
    const fitness = { scrollTo: jest.fn() };
    const { getByLabelText } = await render(
      <>
        <FakeList tab="/" list={feed} />
        <FakeScrollView tab="/fitness" view={fitness} />
        <BottomTabBar />
      </>
    );

    await fireEvent.press(getByLabelText('navigation.fitness'));

    expect(navigateTab).toHaveBeenCalledWith('/fitness');
    expect(feed.scrollToOffset).not.toHaveBeenCalled();
    expect(fitness.scrollTo).not.toHaveBeenCalled();
  });

  it('a scroll view on the reselected tab goes back to the top, and other tabs stay put', async () => {
    mockPathname = '/fitness';
    const feed = { scrollToOffset: jest.fn() };
    const fitness = { scrollTo: jest.fn() };
    const { getByLabelText } = await render(
      <>
        <FakeList tab="/" list={feed} />
        <FakeScrollView tab="/fitness" view={fitness} />
        <BottomTabBar />
      </>
    );

    await fireEvent.press(getByLabelText('navigation.fitness'));

    expect(fitness.scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
    expect(feed.scrollToOffset).not.toHaveBeenCalled();
    expect(navigateTab).not.toHaveBeenCalled();
  });

  it('a list that has unmounted is not scrolled', async () => {
    const feed = { scrollToOffset: jest.fn() };
    const { getByLabelText, rerender } = await render(
      <>
        <FakeList tab="/" list={feed} />
        <BottomTabBar />
      </>
    );

    await rerender(<BottomTabBar />);
    await fireEvent.press(getByLabelText('navigation.feed'));

    expect(feed.scrollToOffset).not.toHaveBeenCalled();
  });

  it('reselecting the map, which has no list, does nothing', async () => {
    mockPathname = '/map';
    const feed = { scrollToOffset: jest.fn() };
    const { getByLabelText } = await render(
      <>
        <FakeList tab="/" list={feed} />
        <BottomTabBar />
      </>
    );

    await fireEvent.press(getByLabelText('navigation.map'));

    expect(feed.scrollToOffset).not.toHaveBeenCalled();
    expect(navigateTab).not.toHaveBeenCalled();
  });
});
