/**
 * Scenario: the tab group sat in the root stack with an empty title, so a detail screen pushed
 * from a tab had nothing to name its back control after, and iOS fell back to a generic label.
 *
 * Expected behaviour: whenever a tab takes focus, the tab group's entry in the root stack is
 * titled with that tab's name.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import TabsLayout from '@/app/(tabs)/_layout';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

type Listeners = (props: {
  navigation: { getParent: () => { setOptions: (options: object) => void } };
  route: { name: string };
}) => Record<string, () => void>;
let mockScreenListeners: Listeners | undefined;
const mockScreenNames: string[] = [];
const mockSetOptions = jest.fn();
// A tab's navigation, whose parent is the tab group's entry in the root stack.
const tabNavigation = { getParent: () => ({ setOptions: mockSetOptions }) };

jest.mock('expo-router', () => {
  function Tabs({
    screenListeners,
    children,
  }: {
    screenListeners?: Listeners;
    children?: React.ReactNode;
  }) {
    mockScreenListeners = screenListeners;
    return children ?? null;
  }
  Tabs.Screen = function TabsScreen({ name }: { name: string }) {
    mockScreenNames.push(name);
    return null;
  };
  return { ...jest.requireActual('expo-router'), Tabs };
});

describe('the tab group title', () => {
  beforeEach(() => {
    mockScreenListeners = undefined;
    mockScreenNames.length = 0;
    mockSetOptions.mockClear();
  });

  it.each([
    ['(feed)', 'navigation.feed'],
    ['fitness', 'navigation.fitness'],
    ['map', 'navigation.map'],
    ['insights', 'navigation.insights'],
    ['settings', 'navigation.settings'],
  ])('names the group after the %s tab when it takes focus', async (tab, title) => {
    await render(<TabsLayout />);
    mockScreenListeners?.({ navigation: tabNavigation, route: { name: tab } }).focus?.();
    expect(mockSetOptions).toHaveBeenLastCalledWith({ title });
  });

  it('registers Settings as a tab of the group', async () => {
    await render(<TabsLayout />);
    expect(mockScreenNames).toContain('settings');
  });

  it('follows a second tab focus rather than keeping the first', async () => {
    await render(<TabsLayout />);
    mockScreenListeners?.({ navigation: tabNavigation, route: { name: 'map' } }).focus?.();
    mockScreenListeners?.({ navigation: tabNavigation, route: { name: 'fitness' } }).focus?.();
    expect(mockSetOptions).toHaveBeenCalledTimes(2);
    expect(mockSetOptions).toHaveBeenLastCalledWith({ title: 'navigation.fitness' });
  });
});
