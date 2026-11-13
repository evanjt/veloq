/**
 * Scenario: a link reaches the linked devices screen, with the remote link's
 * experimental switch off and then on.
 *
 * Expected behaviour: off, the screen leaves at once and shows nothing of the
 * feature. On, the screen and its link action are there.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import LinkedDevicesScreen from '@/app/linked-devices';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { goBack } from '@/shared/app/navigation';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => {}),
  removeSetting: jest.fn(async () => {}),
}));
jest.mock('@/shared/app/navigation', () => ({
  ...jest.requireActual('@/shared/app/navigation'),
  goBack: jest.fn(),
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

beforeEach(() => jest.clearAllMocks());

describe('the linked devices screen behind its switch', () => {
  it('leaves at once while the switch is off', async () => {
    useDebugStore.setState({ experimentalFeatures: {} });
    const screen = await render(<LinkedDevicesScreen />);
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(screen.queryByTestId('linked-devices-screen')).toBeNull();
    expect(screen.queryByTestId('remote-link-link')).toBeNull();
  });

  it('shows the screen and its link action while the switch is on', async () => {
    useDebugStore.setState({ experimentalFeatures: { remoteLink: true } });
    const screen = await render(<LinkedDevicesScreen />);
    expect(goBack).not.toHaveBeenCalled();
    expect(screen.getByTestId('linked-devices-screen')).toBeTruthy();
    expect(screen.getByTestId('remote-link-link')).toBeTruthy();
  });
});
