/**
 * Scenario: a linked browser changes something while Veloq is open on the phone.
 *
 * Expected behaviour: the connected banner names the newest change in place of
 * the count, then returns to the count. Nothing is named while no browser is
 * connected, and a write with no row to name leaves the count showing.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import { RemoteLinkBanner } from '@/features/settings/components/RemoteLinkBanner';
import { useRemoteLinkStatus } from '@/shared/app/remoteLinkStatus';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

const listeners = new Map<string, Set<() => void>>();
const mockEngine = {
  subscribe: (event: string, callback: () => void) => {
    const set = listeners.get(event) ?? new Set<() => void>();
    listeners.set(event, set.add(callback));
    return () => set.delete(callback);
  },
};
const emit = (event: string) => listeners.get(event)?.forEach((callback) => callback());

jest.mock('@/shared/native/engine', () => ({
  ...jest.requireActual('@/shared/native/engine'),
  getEngine: () => mockEngine,
}));

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    remote: {
      listLinkedDevices: jest.fn(),
      recentWrites: jest.fn(),
    },
  })
);

jest.mock('@/features/settings/lib/remoteLinkSession', () => ({
  disconnectRemoteLink: jest.fn(),
}));

const mockRemote = jest.requireMock('veloqrs').remote as Record<string, jest.Mock>;

const LAPTOP = { id: '7', name: 'Firefox on Linux', createdAt: 1_700_000_000, lastSeenAt: null };
const RENAME = {
  deviceId: '7',
  method: 'section.rename',
  targetId: 's_a',
  summary: 'Renamed section Climb 1 to Col',
  at: 1_700_000_200,
};
const SHOWN_MS = 4_000;

const count = (n: number) => `remoteLink.connected:${JSON.stringify({ count: n })}`;
const wrote = (browser: string, summary: string) =>
  `remoteLink.wrote:${JSON.stringify({ browser, summary })}`;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  listeners.clear();
  mockRemote.listLinkedDevices.mockReturnValue([LAPTOP]);
  mockRemote.recentWrites.mockReturnValue([RENAME]);
  useRemoteLinkStatus.setState({ connected: 1, linked: 1, rooms: 0 });
});

afterEach(() => {
  jest.useRealTimers();
  useRemoteLinkStatus.setState({ connected: 0, linked: 0, rooms: 0 });
});

describe('remote link banner', () => {
  it('names the newest change in place of the count, then returns to the count', async () => {
    const tree = await render(<RemoteLinkBanner />);
    expect(tree.getByText(count(1))).toBeTruthy();

    await act(async () => emit('remoteWrote'));
    expect(tree.getByText(wrote('Firefox on Linux', RENAME.summary))).toBeTruthy();
    expect(tree.queryByText(count(1))).toBeNull();

    await act(async () => jest.advanceTimersByTime(SHOWN_MS));
    expect(tree.getByText(count(1))).toBeTruthy();
    expect(tree.queryByText(wrote('Firefox on Linux', RENAME.summary))).toBeNull();
  });

  it('names the change from whichever browser made the newest one', async () => {
    const TABLET = {
      id: '8',
      name: 'Chrome on Android',
      createdAt: 1_700_000_001,
      lastSeenAt: null,
    };
    const EARLIER = {
      ...RENAME,
      deviceId: '8',
      summary: 'Renamed section Climb 2 to Ridge',
      at: 1_700_000_100,
    };
    mockRemote.listLinkedDevices.mockReturnValue([LAPTOP, TABLET]);
    mockRemote.recentWrites.mockImplementation((id: string) =>
      id === LAPTOP.id ? [RENAME] : [EARLIER]
    );

    const tree = await render(<RemoteLinkBanner />);
    await act(async () => emit('remoteWrote'));

    expect(tree.getByText(wrote('Firefox on Linux', RENAME.summary))).toBeTruthy();
  });

  vaultIt('keeps the count when a write has no row to name', async () => {
    mockRemote.recentWrites.mockReturnValue([]);
    const tree = await render(<RemoteLinkBanner />);

    await act(async () => emit('remoteWrote'));

    expect(tree.getByText(count(1))).toBeTruthy();
  });

  vaultIt('shows nothing for a write while no browser is connected', async () => {
    useRemoteLinkStatus.setState({ connected: 0 });
    const tree = await render(<RemoteLinkBanner />);

    await act(async () => emit('remoteWrote'));

    expect(tree.queryByTestId('remote-link-banner')).toBeNull();
  });
});
