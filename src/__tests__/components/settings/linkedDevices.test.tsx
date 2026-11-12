/**
 * Scenario: the athlete manages the browsers linked to the library, and links
 * a new one by scanning the code its page shows.
 *
 * Expected behaviour: removing asks first, then unlinks the browser and closes
 * its room. A code the engine refuses joins no room. A good code waits in the
 * browser's room; once the browser proves the secret the athlete is asked, and
 * only an accept links it. Either answer leaves the pairing room.
 */

import React from 'react';
import { act, fireEvent, render, within } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';

import { LinkedDevices } from '@/features/settings/components/LinkedDevices';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

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

type CameraProps = { onBarcodeScanned?: (result: { data: string }) => void };
const camera: { props: CameraProps } = { props: {} };

jest.mock('expo-camera', () => ({
  ...jest.requireActual('expo-camera'),
  CameraView: (props: CameraProps) => {
    camera.props = props;
    return null;
  },
  useCameraPermissions: jest.fn(),
}));

const mockConfirmAction = jest.fn();
jest.mock('@/shared/ui/dialog', () => ({
  confirmAction: (args: unknown) => mockConfirmAction(args),
}));

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    remote: {
      listLinkedDevices: jest.fn(),
      removeLinkedDevice: jest.fn(),
      recentWrites: jest.fn(),
      beginPairing: jest.fn(),
      pairingRequest: jest.fn(),
      confirmPairing: jest.fn(),
      cancelPairing: jest.fn(),
    },
  })
);
jest.mock('@/features/settings/lib/remoteLinkSession', () => ({
  remoteLink: { refresh: jest.fn(), join: jest.fn(), leave: jest.fn() },
}));

const mockRemote = jest.requireMock('veloqrs').remote as Record<string, jest.Mock>;
const mockLink = jest.requireMock('@/features/settings/lib/remoteLinkSession').remoteLink as Record<
  string,
  jest.Mock
>;

const LAPTOP = { id: '7', name: 'Firefox on Linux', createdAt: 1_700_000_000, lastSeenAt: null };
const TABLET = { id: '8', name: 'Chrome on Android', createdAt: 1_700_000_001, lastSeenAt: null };
const NEWEST = {
  deviceId: '7',
  method: 'section.rename',
  targetId: 's_a',
  summary: 'Renamed section Climb 1 to Col',
  at: 1_700_000_200,
};
const OLDER = {
  deviceId: '7',
  method: 'section.rename',
  targetId: 's_b',
  summary: 'Renamed section Climb 2 to Ridge',
  at: 1_700_000_100,
};
const ROOM = 'room-0123456789abcdefghij';
const GOOD_CODE = '{"v":1,"room":"room-0123456789abcdefghij"}';

type Confirm = { onConfirm: () => void; onCancel?: () => void };
const lastConfirm = (): Confirm => mockConfirmAction.mock.calls.at(-1)[0] as Confirm;

beforeEach(() => {
  jest.useFakeTimers();
  jest.clearAllMocks();
  camera.props = {};
  (useCameraPermissions as jest.Mock).mockReturnValue([
    { status: 'granted', granted: true, canAskAgain: true },
    jest.fn(),
    jest.fn().mockResolvedValue(undefined),
  ]);
  mockRemote.listLinkedDevices.mockReturnValue([LAPTOP]);
  mockRemote.recentWrites.mockReturnValue([]);
  mockRemote.pairingRequest.mockReturnValue(null);
  mockRemote.beginPairing.mockImplementation((qr: string) => {
    if (qr !== GOOD_CODE) throw new Error('pairing refused: Malformed');
    return ROOM;
  });
});

afterEach(() => jest.useRealTimers());

async function scan(tree: Awaited<ReturnType<typeof render>>, data: string) {
  await act(async () => fireEvent.press(tree.getByTestId('remote-link-link')));
  const handler = camera.props.onBarcodeScanned;
  expect(handler).toBeDefined();
  await act(async () => handler?.({ data }));
}

describe('linked devices', () => {
  it('removes a browser only once the athlete confirms, and closes its room', async () => {
    const tree = await render(<LinkedDevices />);
    await act(async () => fireEvent.press(tree.getByTestId('linked-device-7')));
    expect(mockRemote.removeLinkedDevice).not.toHaveBeenCalled();

    mockRemote.listLinkedDevices.mockReturnValue([]);
    await act(async () => lastConfirm().onConfirm());

    expect(mockRemote.removeLinkedDevice).toHaveBeenCalledWith('7');
    expect(mockLink.refresh).toHaveBeenCalled();
    expect(tree.queryByTestId('linked-device-7')).toBeNull();
    expect(tree.getByText('remoteLink.empty')).toBeTruthy();
  });

  it('joins no room for a code the engine refuses', async () => {
    const tree = await render(<LinkedDevices />);
    await scan(tree, 'WIFI:T:WPA;S:Orchard Shed;;');

    expect(mockLink.join).not.toHaveBeenCalled();
    expect(tree.getByText('remoteLink.invalidCode')).toBeTruthy();
  });

  it('links a proved browser only after the athlete accepts', async () => {
    const tree = await render(<LinkedDevices />);
    await scan(tree, GOOD_CODE);
    expect(mockLink.join).toHaveBeenCalledWith(ROOM);
    expect(tree.getByTestId('remote-link-waiting')).toBeTruthy();

    await act(async () => jest.advanceTimersByTime(1_000));
    expect(mockConfirmAction).not.toHaveBeenCalled();

    mockRemote.pairingRequest.mockReturnValue('Chrome on Windows');
    await act(async () => jest.advanceTimersByTime(1_000));
    expect(mockConfirmAction).toHaveBeenCalledTimes(1);
    expect(mockRemote.confirmPairing).not.toHaveBeenCalled();

    await act(async () => lastConfirm().onConfirm());
    expect(mockRemote.confirmPairing).toHaveBeenCalledWith(true);
    expect(mockLink.leave).toHaveBeenCalledWith(ROOM);
    expect(mockLink.refresh).toHaveBeenCalled();
  });

  it('declines a proved browser without linking it', async () => {
    const tree = await render(<LinkedDevices />);
    await scan(tree, GOOD_CODE);
    mockRemote.pairingRequest.mockReturnValue('Chrome on Windows');
    await act(async () => jest.advanceTimersByTime(1_000));

    await act(async () => lastConfirm().onCancel?.());
    expect(mockRemote.confirmPairing).toHaveBeenCalledWith(false);
    expect(mockLink.leave).toHaveBeenCalledWith(ROOM);
    expect(mockLink.refresh).not.toHaveBeenCalled();
  });

  it('gives up on a browser that never proves, and leaves its room', async () => {
    const tree = await render(<LinkedDevices />);
    await scan(tree, GOOD_CODE);
    await act(async () => jest.advanceTimersByTime(131_000));

    expect(mockRemote.cancelPairing).toHaveBeenCalled();
    expect(mockLink.leave).toHaveBeenCalledWith(ROOM);
    expect(tree.getByText('remoteLink.expired')).toBeTruthy();
  });
});

describe('recent changes', () => {
  beforeEach(() => {
    mockRemote.listLinkedDevices.mockReturnValue([LAPTOP, TABLET]);
    mockRemote.recentWrites.mockImplementation((id: string) =>
      id === LAPTOP.id ? [NEWEST, OLDER] : []
    );
  });

  it('lists each browser changes under its own row, newest first', async () => {
    const tree = await render(<LinkedDevices />);
    const laptop = within(tree.getByTestId(`linked-device-writes-${LAPTOP.id}`));

    expect(mockRemote.recentWrites).toHaveBeenCalledWith(LAPTOP.id, expect.any(Number));
    expect(laptop.getAllByText(/^Renamed section/).map((node) => node.props.children)).toEqual([
      NEWEST.summary,
      OLDER.summary,
    ]);
    expect(laptop.queryByText('remoteLink.noChanges')).toBeNull();
  });

  it('says there are no changes under a browser that has made none', async () => {
    const tree = await render(<LinkedDevices />);
    const tablet = within(tree.getByTestId(`linked-device-writes-${TABLET.id}`));

    expect(tablet.getByText('remoteLink.noChanges')).toBeTruthy();
    expect(tablet.queryByText(NEWEST.summary)).toBeNull();
    expect(tree.queryAllByText(NEWEST.summary)).toHaveLength(1);
  });

  it('reads the changes again when a linked browser writes while the screen is open', async () => {
    mockRemote.recentWrites.mockReturnValue([]);
    const tree = await render(<LinkedDevices />);
    expect(tree.queryByText(NEWEST.summary)).toBeNull();

    mockRemote.recentWrites.mockImplementation((id: string) => (id === LAPTOP.id ? [NEWEST] : []));
    await act(async () => emit('remoteWrote'));

    expect(tree.getByText(NEWEST.summary)).toBeTruthy();
  });
});
