/**
 * Scenario: the athlete is on Settings with the remote link switched on and a
 * browser linked, which is connected, waiting for it to connect, or not
 * reachable.
 *
 * Expected behaviour: the title bar shows a dot in the state the link is in,
 * named in full for a screen reader. It is absent while the switch is off or
 * nothing is linked. A tap opens the linked browsers sheet.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { RemoteLinkHeaderItem } from '@/features/settings/components/RemoteLinkHeaderItem';
import { useDebugStore } from '@/features/settings/stores/DebugStore';
import { useRemoteLinkStatus } from '@/shared/app/remoteLinkStatus';
import { initialiseI18n, changeLanguage } from '@/i18n';

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

const mockOpenSheet = jest.fn();
jest.mock('@/shared/app/sheetRequest', () => ({
  openSheet: (...args: unknown[]) => mockOpenSheet(...args),
}));

function setStatus(connected: number, linked: number, rooms: number) {
  useRemoteLinkStatus.setState({ connected, linked, rooms });
}

describe('RemoteLinkHeaderItem', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  beforeEach(async () => {
    await changeLanguage('en-GB');
    mockOpenSheet.mockReset();
    useDebugStore.setState({ experimentalFeatures: { remoteLink: true } });
    setStatus(0, 0, 0);
  });

  it('shows nothing while the remote link is switched off', () => {
    useDebugStore.setState({ experimentalFeatures: {} });
    setStatus(1, 1, 1);
    const tree = render(<RemoteLinkHeaderItem />);
    expect(tree.queryByTestId('remote-link-header-item')).toBeNull();
  });

  it('shows nothing while no browser is linked', () => {
    setStatus(0, 0, 0);
    const tree = render(<RemoteLinkHeaderItem />);
    expect(tree.queryByTestId('remote-link-header-item')).toBeNull();
  });

  it('shows a connected dot while a linked browser is connected', () => {
    setStatus(1, 1, 1);
    const tree = render(<RemoteLinkHeaderItem />);
    expect(tree.getByLabelText('A linked browser is connected')).toBeTruthy();
    expect(tree.getByTestId('remote-link-header-connected')).toBeTruthy();
    expect(tree.queryByTestId('remote-link-header-waiting')).toBeNull();
    expect(tree.queryByTestId('remote-link-header-unreachable')).toBeNull();
  });

  it('shows a waiting dot while the phone is in a room and no browser has connected', () => {
    setStatus(0, 2, 2);
    const tree = render(<RemoteLinkHeaderItem />);
    expect(tree.getByLabelText('Waiting for a linked browser to connect')).toBeTruthy();
    expect(tree.getByTestId('remote-link-header-waiting')).toBeTruthy();
  });

  it('shows an unreachable dot when no room is open on the relay', () => {
    setStatus(0, 1, 0);
    const tree = render(<RemoteLinkHeaderItem />);
    expect(tree.getByLabelText('A linked browser cannot be reached')).toBeTruthy();
    expect(tree.getByTestId('remote-link-header-unreachable')).toBeTruthy();
  });

  it('opens the linked browsers sheet on a tap', () => {
    setStatus(1, 1, 1);
    const tree = render(<RemoteLinkHeaderItem />);
    fireEvent.press(tree.getByTestId('remote-link-header-item'));
    expect(mockOpenSheet).toHaveBeenCalledWith('sheets/remote-link', {});
  });
});
