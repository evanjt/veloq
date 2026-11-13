/**
 * Scenario: the tab navigator holds five screens, two of which boot WebViews.
 * A colour-scheme flip must reach them through the theme hooks, not by
 * rebuilding the navigator.
 *
 * Expected behaviour: the navigator and a screen under it mount once across
 * any number of scheme flips, and a flip to a preference that resolves to the
 * scheme already in force changes nothing.
 */

import React, { act } from 'react';
import { render } from '@testing-library/react-native';
import { Text, type ColorSchemeName } from 'react-native';

import TabsLayout from '@/app/(tabs)/_layout';
import { setThemePreference, useResolvedColorScheme } from '@/shared/app/ThemeProvider';

jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockMounts = { navigator: 0, screen: 0 };
let mockSystemScheme: NonNullable<ColorSchemeName> = 'light';

jest.mock('react-native/Libraries/Utilities/useColorScheme', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useColorScheme'),
  __esModule: true,
  default: () => mockSystemScheme,
}));

jest.mock('expo-router', () => {
  const { useEffect: useMountEffect } = require('react');
  const { Text: MockText } = require('react-native');

  function ScreenProbe() {
    useMountEffect(() => {
      mockMounts.screen += 1;
    }, []);
    return <MockText testID="screen-probe">screen</MockText>;
  }

  function Tabs({ children }: { children?: unknown }) {
    useMountEffect(() => {
      mockMounts.navigator += 1;
    }, []);
    return (
      <>
        <ScreenProbe />
        {children as never}
      </>
    );
  }
  Tabs.Screen = function TabsScreen() {
    return null;
  };
  return { ...jest.requireActual('expo-router'), Tabs };
});

async function setPreference(preference: 'system' | 'light' | 'dark'): Promise<void> {
  await act(async () => {
    await setThemePreference(preference);
  });
}

function SchemeProbe() {
  const scheme = useResolvedColorScheme();
  return <Text testID="scheme">{scheme}</Text>;
}

function Harness() {
  return (
    <>
      <SchemeProbe />
      <TabsLayout />
    </>
  );
}

beforeEach(async () => {
  mockMounts.navigator = 0;
  mockMounts.screen = 0;
  mockSystemScheme = 'light';
  await setPreference('light');
});

describe('tab navigator across a colour-scheme flip', () => {
  it('mounts once and stays mounted on a re-render with the scheme unchanged (control)', async () => {
    const api = await render(<Harness />);
    await api.rerender(<Harness />);

    expect(mockMounts).toEqual({ navigator: 1, screen: 1 });
  });

  it('does not remount the navigator or a screen when the scheme flips', async () => {
    const api = await render(<Harness />);

    await setPreference('dark');

    expect(api.getByTestId('scheme').props.children).toBe('dark');
    expect(mockMounts).toEqual({ navigator: 1, screen: 1 });
  });

  it('does not remount across two flips in a row', async () => {
    const api = await render(<Harness />);

    await setPreference('dark');
    await setPreference('light');

    expect(api.getByTestId('scheme').props.children).toBe('light');
    expect(mockMounts).toEqual({ navigator: 1, screen: 1 });
  });

  it('does not remount on a switch to system when the system scheme equals the current one', async () => {
    await render(<Harness />);

    await setPreference('system');

    expect(mockMounts).toEqual({ navigator: 1, screen: 1 });
  });
});
