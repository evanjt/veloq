/**
 * Scenario: the tab bar is mounted at the layout root, above the Stack, so it
 * paints over whatever screen is showing.
 *
 * Expected behaviour: a signed-out user gets no tabs. The five destinations
 * are unreachable without a session, and the bar's band collides with the
 * login card's footer line.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { BottomTabBar } from '@/shared/ui/BottomTabBar';

const authState = { isAuthenticated: false, isDemoMode: false };

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('@/shared/app/AuthStore', () => ({
  useAuthStore: (selector: (s: typeof authState) => unknown) => selector(authState),
}));

jest.mock('expo-router', () => ({ usePathname: () => '/' }));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 24, left: 0, right: 0 }),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

describe('BottomTabBar', () => {
  beforeEach(() => {
    authState.isAuthenticated = false;
    authState.isDemoMode = false;
  });

  it('renders nothing without a session', () => {
    const { queryByTestId } = render(<BottomTabBar />);

    expect(queryByTestId('bottom-tab-bar')).toBeNull();
  });

  it('renders the destinations for a signed-in athlete', () => {
    authState.isAuthenticated = true;

    const { getByTestId, getByLabelText } = render(<BottomTabBar />);

    expect(getByTestId('bottom-tab-bar')).toBeTruthy();
    expect(getByLabelText('navigation.feed')).toBeTruthy();
  });

  it('renders the destinations in demo mode', () => {
    authState.isAuthenticated = true;
    authState.isDemoMode = true;

    const { getByTestId } = render(<BottomTabBar />);

    expect(getByTestId('bottom-tab-bar')).toBeTruthy();
  });
});
