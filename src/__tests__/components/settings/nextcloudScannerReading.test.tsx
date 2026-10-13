/**
 * Scenario: the camera reads a QR code that is not a Nextcloud login, such as
 * a Wi-Fi code on the same sheet of paper, or the room is too dark to read
 * the code at all.
 *
 * Expected behaviour: the scanner stays open, says the code is not a
 * Nextcloud login and reads again a moment later, handing over only a valid
 * login. A torch button switches the camera's light on and off.
 */

import React from 'react';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';

import { NextcloudQrScanner } from '@/features/settings/components/NextcloudQrScanner';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

type CameraProps = {
  enableTorch?: boolean;
  onBarcodeScanned?: (result: { data: string }) => void;
};
const camera: { props: CameraProps } = { props: {} };

jest.mock('expo-camera', () => ({
  ...jest.requireActual('expo-camera'),
  CameraView: (props: CameraProps) => {
    camera.props = props;
    return null;
  },
  useCameraPermissions: jest.fn(),
}));

const WIFI_CODE = 'WIFI:T:WPA;S:Orchard Shed;P:pear-tree-42;;';
const LOGIN_CODE = 'nc://login/user:marigold&password:abc-def&server:https://cloud.example.org';

async function renderScanner() {
  const onScanned = jest.fn();
  const onClose = jest.fn();
  const tree = await render(
    <NextcloudQrScanner onScanned={onScanned} onClose={onClose} onEnterDetails={jest.fn()} />
  );
  return { tree, onScanned, onClose };
}

async function scan(data: string) {
  const handler = camera.props.onBarcodeScanned;
  expect(handler).toBeDefined();
  await act(async () => handler?.({ data }));
}

beforeEach(() => {
  jest.useFakeTimers();
  camera.props = {};
  (useCameraPermissions as jest.Mock).mockReturnValue([
    { status: 'granted', granted: true, canAskAgain: true },
    jest.fn(),
    jest.fn().mockResolvedValue(undefined),
  ]);
});

afterEach(() => jest.useRealTimers());

describe('a code that is not a Nextcloud login', () => {
  it('stays open with the message and hands nothing over', async () => {
    const { tree, onScanned, onClose } = await renderScanner();

    await scan(WIFI_CODE);

    expect(tree.getByText('backup.invalidQrCode')).toBeTruthy();
    expect(onScanned).not.toHaveBeenCalled();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('pauses reading, then reads again and accepts a login', async () => {
    const { tree, onScanned } = await renderScanner();

    await scan(WIFI_CODE);
    expect(camera.props.onBarcodeScanned).toBeUndefined();

    await act(async () => jest.advanceTimersByTime(1000));
    expect(tree.queryByText('backup.invalidQrCode')).toBeNull();

    await scan(LOGIN_CODE);
    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(onScanned).toHaveBeenCalledWith({
      url: 'https://cloud.example.org/remote.php/dav/files/marigold/',
      user: 'marigold',
      password: 'abc-def',
    });
  });

  it('reads again after a second wrong code too', async () => {
    const { onScanned } = await renderScanner();

    await scan(WIFI_CODE);
    await act(async () => jest.advanceTimersByTime(1000));
    await scan(WIFI_CODE);
    await act(async () => jest.advanceTimersByTime(1000));

    expect(camera.props.onBarcodeScanned).toBeDefined();
    expect(onScanned).not.toHaveBeenCalled();
  });
});

describe('a Nextcloud login', () => {
  it('is handed over once and reading stops', async () => {
    const { onScanned } = await renderScanner();

    await scan(LOGIN_CODE);
    await act(async () => jest.advanceTimersByTime(1000));

    expect(onScanned).toHaveBeenCalledTimes(1);
    expect(camera.props.onBarcodeScanned).toBeUndefined();
  });
});

describe('torch', () => {
  it('starts off and toggles the camera light from its button', async () => {
    const { tree } = await renderScanner();
    expect(camera.props.enableTorch).toBe(false);

    await fireEvent.press(tree.getByLabelText('backup.torchOn'));
    expect(camera.props.enableTorch).toBe(true);

    await fireEvent.press(tree.getByLabelText('backup.torchOff'));
    expect(camera.props.enableTorch).toBe(false);
  });
});
