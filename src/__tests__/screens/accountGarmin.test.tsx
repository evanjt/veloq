/**
 * Scenario: the Garmin connector sat in a Data sources row apart from the
 * athlete's account.
 *
 * Expected behaviour: while Garmin's experimental switch is on, the account
 * screen holds a Garmin row under the intervals.icu sign-in that opens the
 * connector, and a demo account finds the demo banner switch there.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import AccountScreen from '@/app/account';
import { useAuthStore } from '@/shared/app/AuthStore';
import { useDebugStore } from '@/features/settings/stores/DebugStore';

const mockNavigateTo = jest.fn();
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  navigateTo: (...a: unknown[]) => mockNavigateTo(...a),
}));

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: null }) }));
jest.mock('@/features/settings/hooks/useGarminConnectorState', () => ({
  useGarminConnectorState: () => 'keyNeeded',
}));
jest.mock('@/features/settings/components/ProfileAccountSection', () => ({
  ProfileAccountSection: () => null,
}));

describe('the account screen', () => {
  beforeEach(() => {
    mockNavigateTo.mockClear();
    useAuthStore.setState({ isDemoMode: false });
    useDebugStore.setState({
      experimentalEnabled: true,
      experimentalFeatures: { garminUpdate: true },
    });
  });

  it('opens the Garmin connector from its Garmin row, showing that a key is needed', async () => {
    const screen = await render(<AccountScreen />);
    const row = screen.getByTestId('settings-nav-garmin');
    expect(screen.getByText('garmin.keyNeeded')).toBeTruthy();
    fireEvent.press(row);
    expect(mockNavigateTo).toHaveBeenCalledWith('/garmin-connector');
  });

  it('shows the demo banner switch in demo mode only', async () => {
    const signedIn = await render(<AccountScreen />);
    expect(signedIn.queryByTestId('hide-demo-banner-switch')).toBeNull();
    signedIn.unmount();

    useAuthStore.setState({ isDemoMode: true });
    const demo = await render(<AccountScreen />);
    expect(demo.getByTestId('hide-demo-banner-switch')).toBeTruthy();
  });
});
