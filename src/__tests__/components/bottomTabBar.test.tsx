/**
 * Scenario: the tab bar is mounted at the layout root, above the Stack, so it
 * paints over whatever screen is showing.
 *
 * Expected behaviour: a signed-out user gets no tabs. The five destinations
 * are unreachable without a session, and the bar's band collides with the
 * login card's footer line.
 */

import React from 'react';
import { Platform } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import * as Haptics from 'expo-haptics';
import { router } from 'expo-router';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  selectionAsync: jest.fn(() => Promise.resolve()),
  impactAsync: jest.fn(() => Promise.resolve()),
  performAndroidHapticsAsync: jest.fn(() => Promise.resolve()),
  ImpactFeedbackStyle: { Light: 'light' },
}));

let mockSegments: string[] = ['(tabs)'];

// The router refuses to navigate before an app root has rendered, and the bar renders alone.
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { navigate: jest.fn() },
  usePathname: () => '/',
  useSegments: () => mockSegments,
}));

const authState = { isAuthenticated: false, isDemoMode: false };

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

describe('BottomTabBar', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.isDemoMode = false;
    mockSegments = ['(tabs)'];
    jest.clearAllMocks();
  });

  it('renders nothing on a stack screen outside the tabs group', async () => {
    authState.isAuthenticated = true;
    mockSegments = ['backup-settings'];

    const { queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar')).toBeNull();
  });

  it('renders nothing on the recording screen', async () => {
    authState.isAuthenticated = true;
    mockSegments = ['record'];

    const { queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar')).toBeNull();
  });

  it('renders nothing without a session', async () => {
    const { queryByTestId } = await render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar')).toBeNull();
  });

  it('renders the destinations for a signed-in athlete', async () => {
    authState.isAuthenticated = true;

    const { getByTestId, getByLabelText } = await render(<BottomTabBar />);

    expect(getByTestId('bottom-tab-bar')).toBeTruthy();
    expect(getByLabelText('navigation.feed')).toBeTruthy();
  });

  it('carries Settings as the fifth tab, under its own short label, and opens it', async () => {
    authState.isAuthenticated = true;
    const { getAllByRole, getByLabelText } = await render(<BottomTabBar />);

    expect(getAllByRole('tab').map((tab) => tab.props.accessibilityLabel)).toEqual([
      'navigation.feed',
      'navigation.fitness',
      'navigation.map',
      'navigation.insights',
      'navigation.settingsTab',
    ]);
    await fireEvent.press(getByLabelText('navigation.settingsTab'));
    expect(router.navigate).toHaveBeenCalledWith('/settings');
  });

  it('renders the destinations in demo mode', async () => {
    authState.isAuthenticated = true;
    authState.isDemoMode = true;

    const { getByTestId } = await render(<BottomTabBar />);

    expect(getByTestId('bottom-tab-bar')).toBeTruthy();
  });

  it('switching tab fires one selection haptic and no impact, and the current tab fires none', async () => {
    authState.isAuthenticated = true;
    const { getByLabelText } = await render(<BottomTabBar />);

    await fireEvent.press(getByLabelText('navigation.feed'));
    expect(Haptics.selectionAsync).not.toHaveBeenCalled();

    await fireEvent.press(getByLabelText('navigation.fitness'));

    expect(Haptics.selectionAsync).toHaveBeenCalledTimes(1);
    expect(Haptics.impactAsync).not.toHaveBeenCalled();
  });

  it('fires the selection haptic on Android too, and none for the current tab', async () => {
    const originalOS = Platform.OS;
    Platform.OS = 'android';
    try {
      authState.isAuthenticated = true;
      const { getByLabelText } = await render(<BottomTabBar />);

      await fireEvent.press(getByLabelText('navigation.feed'));
      expect(Haptics.performAndroidHapticsAsync).not.toHaveBeenCalled();

      await fireEvent.press(getByLabelText('navigation.fitness'));

      expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledTimes(1);
      expect(Haptics.performAndroidHapticsAsync).toHaveBeenCalledWith('segment-tick');
      expect(Haptics.selectionAsync).not.toHaveBeenCalled();
      expect(Haptics.impactAsync).not.toHaveBeenCalled();
    } finally {
      Platform.OS = originalOS;
    }
  });
});
