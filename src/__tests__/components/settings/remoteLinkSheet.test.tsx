/**
 * Scenario: the athlete opens the linked browsers sheet from the Settings dot,
 * with one browser connected since a time and another linked but not
 * connected.
 *
 * Expected behaviour: each browser is named with its connection state, and the
 * connected one's time. Disconnect ends every connection and is offered only
 * while one is up. Manage linked devices closes the sheet and opens the
 * linked devices screen.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';

import { RemoteLinkSheet } from '@/features/settings/components/RemoteLinkSheet';
import { disconnectRemoteLink } from '@/features/settings/lib/remoteLinkSession';
import { useRemoteLinkStatus } from '@/shared/app/remoteLinkStatus';
import { goBack, navigateTo } from '@/shared/app/navigation';
import { initialiseI18n, changeLanguage } from '@/i18n';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    remote: { listLinkedDevices: jest.fn() },
  })
);
jest.mock('@/features/settings/lib/remoteLinkSession', () => ({
  disconnectRemoteLink: jest.fn(),
}));
jest.mock('@/shared/app/navigation', () => ({
  navigateTo: jest.fn(),
  goBack: jest.fn(),
}));

const mockRemote = jest.requireMock('veloqrs').remote as Record<string, jest.Mock>;

const CONNECTED_SINCE = 1_700_000_000;
const DESKTOP = {
  id: '7',
  name: 'Firefox on Linux',
  createdAt: 1_699_000_000,
  lastSeenAt: CONNECTED_SINCE,
  connectedSince: CONNECTED_SINCE,
};
const TABLET = {
  id: '9',
  name: 'Chrome on Android',
  createdAt: 1_698_000_000,
  lastSeenAt: null,
  connectedSince: null,
};

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

beforeEach(async () => {
  await changeLanguage('en-GB');
  jest.clearAllMocks();
  mockRemote.listLinkedDevices.mockReturnValue([DESKTOP, TABLET]);
  useRemoteLinkStatus.setState({ connected: 1, linked: 2, rooms: 2 });
});

describe('RemoteLinkSheet', () => {
  it('names each linked browser with its connection, and the time one connected', () => {
    const tree = render(<RemoteLinkSheet />);
    expect(tree.getByText('Firefox on Linux')).toBeTruthy();
    expect(tree.getByText('Chrome on Android')).toBeTruthy();
    expect(tree.getByTestId('linked-browser-7').props.accessibilityLabel).toContain(
      'Connected since'
    );
    expect(tree.getByTestId('linked-browser-9').props.accessibilityLabel).toContain(
      'Not connected'
    );
  });

  it('offers disconnect while a browser is connected, and ends every connection', async () => {
    const tree = render(<RemoteLinkSheet />);
    await act(async () => fireEvent.press(tree.getByTestId('remote-link-sheet-disconnect')));
    expect(disconnectRemoteLink).toHaveBeenCalledTimes(1);
  });

  it('offers no disconnect when no browser is connected', () => {
    useRemoteLinkStatus.setState({ connected: 0, linked: 2, rooms: 2 });
    const tree = render(<RemoteLinkSheet />);
    expect(tree.queryByTestId('remote-link-sheet-disconnect')).toBeNull();
  });

  it('closes the sheet and opens the linked devices screen to manage them', () => {
    const tree = render(<RemoteLinkSheet />);
    fireEvent.press(tree.getByTestId('remote-link-sheet-manage'));
    expect(goBack).toHaveBeenCalledTimes(1);
    expect(navigateTo).toHaveBeenCalledWith('/linked-devices');
  });
});
