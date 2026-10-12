/**
 * Scenario: the Nextcloud scanner opens with the camera not allowed. Once the
 * system has stopped asking, requesting the permission resolves at once with
 * no dialog, so a button wired only to the request does nothing at all.
 *
 * Expected behaviour: while the system will still ask, the notice raises its
 * dialog; once it will not, the notice opens Veloq's page in system settings.
 * Typing the details in is offered in both states, since it works without the
 * camera.
 */

import React from 'react';
import { AppState, Linking } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { useCameraPermissions } from 'expo-camera';

import { NextcloudQrScanner } from '@/features/settings/components/NextcloudQrScanner';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('expo-camera', () => ({
  ...jest.requireActual('expo-camera'),
  CameraView: () => null,
  useCameraPermissions: jest.fn(),
}));

const requestPermission = jest.fn();
const getPermission = jest.fn();
let openSettings: jest.SpyInstance;

function givenCamera(reading: { status: string; granted: boolean; canAskAgain: boolean }) {
  (useCameraPermissions as jest.Mock).mockReturnValue([reading, requestPermission, getPermission]);
}

async function renderScanner() {
  const onClose = jest.fn();
  const onEnterDetails = jest.fn();
  const tree = await render(
    <NextcloudQrScanner onScanned={jest.fn()} onClose={onClose} onEnterDetails={onEnterDetails} />
  );
  return { tree, onClose, onEnterDetails };
}

beforeEach(() => {
  requestPermission.mockReset().mockResolvedValue(undefined);
  getPermission.mockReset().mockResolvedValue(undefined);
  openSettings = jest.spyOn(Linking, 'openSettings').mockResolvedValue(undefined);
});

afterEach(() => openSettings.mockRestore());

describe('camera refused for good', () => {
  beforeEach(() => givenCamera({ status: 'denied', granted: false, canAskAgain: false }));

  it('offers Open settings, which opens the app settings page and asks nothing', async () => {
    const { tree } = await renderScanner();

    await fireEvent.press(tree.getByText('common.openSettings'));

    expect(openSettings).toHaveBeenCalledTimes(1);
    expect(requestPermission).not.toHaveBeenCalled();
    expect(tree.queryByText('common.allow')).toBeNull();
    expect(tree.getByText('permissionNotice.cameraOff')).toBeTruthy();
  });

  it('offers typing the details in instead', async () => {
    const { tree, onEnterDetails } = await renderScanner();

    await fireEvent.press(tree.getByText('backup.enterDetailsInstead'));

    expect(onEnterDetails).toHaveBeenCalledTimes(1);
  });

  it('reads the permission again when the app comes back from settings', async () => {
    await renderScanner();
    const listener = (AppState.addEventListener as jest.Mock).mock.calls.at(-1)?.[1];
    expect(typeof listener).toBe('function');

    await act(async () => listener('active'));

    expect(getPermission).toHaveBeenCalledTimes(1);
  });
});

describe('camera not yet allowed', () => {
  beforeEach(() => givenCamera({ status: 'undetermined', granted: false, canAskAgain: true }));

  it('raises the system dialog from Allow and does not open settings', async () => {
    const { tree } = await renderScanner();

    await fireEvent.press(tree.getByText('common.allow'));

    expect(requestPermission).toHaveBeenCalledTimes(1);
    expect(openSettings).not.toHaveBeenCalled();
    expect(tree.getByText('backup.cameraPermissionNeeded')).toBeTruthy();
  });

  it('offers typing the details in instead', async () => {
    const { tree, onEnterDetails } = await renderScanner();

    await fireEvent.press(tree.getByText('backup.enterDetailsInstead'));

    expect(onEnterDetails).toHaveBeenCalledTimes(1);
  });
});
