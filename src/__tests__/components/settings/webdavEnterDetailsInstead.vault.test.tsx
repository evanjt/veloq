/**
 * Scenario: the camera is not allowed, so the Nextcloud scanner offers typing
 * the server details in instead.
 *
 * Expected behaviour: the scanner closes onto the server address field with
 * the keyboard up, on iOS once the modal has finished dismissing and on Android
 * as soon as it is gone.
 */

import React from 'react';
import { Modal, Platform, TextInput } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { WebdavConfigForm } from '@/features/settings/components/WebdavConfigForm';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/features/settings/lib/autobackup', () => ({
  getWebdavConfig: () => null,
  setWebdavConfig: jest.fn(),
  clearWebdavConfig: jest.fn(),
  testWebdavConnection: jest.fn(),
  webdavUrlProblem: () => null,
}));
jest.mock('@/features/settings/components/NextcloudQrScanner', () => ({
  NextcloudQrScanner: ({ onEnterDetails }: { onEnterDetails: () => void }) => {
    const { Pressable: P, Text: T } = jest.requireActual('react-native');
    return (
      <P onPress={onEnterDetails}>
        <T>enter details</T>
      </P>
    );
  },
}));

let focus: jest.SpyInstance;
const originalOS = Platform.OS;

beforeEach(() => {
  focus = jest.spyOn(TextInput.prototype as never, 'focus' as never);
});

afterEach(() => {
  focus.mockRestore();
  Object.defineProperty(Platform, 'OS', { value: originalOS });
});

async function openScannerThenEnterDetails() {
  const tree = await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);
  await fireEvent.press(tree.getByText('backup.scanNextcloudQr'));
  expect(tree.UNSAFE_getByType(Modal).props.visible).toBe(true);
  await fireEvent.press(tree.getByText('enter details'));
  expect(tree.UNSAFE_getByType(Modal).props.visible).toBe(false);
  return tree;
}

it('focuses the server field once the iOS dismissal ends', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios' });
  const tree = await openScannerThenEnterDetails();
  expect(focus).not.toHaveBeenCalled();

  await act(() => tree.UNSAFE_getByType(Modal).props.onDismiss());

  expect(focus).toHaveBeenCalledTimes(1);
});

it('focuses the server field as soon as the Android modal is gone', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'android' });
  await openScannerThenEnterDetails();

  expect(focus).toHaveBeenCalledTimes(1);
});

it('leaves the field alone when the scanner is merely cancelled', async () => {
  Object.defineProperty(Platform, 'OS', { value: 'ios' });
  const tree = await render(<WebdavConfigForm onConfigChange={jest.fn()} onRemoved={jest.fn()} />);
  await fireEvent.press(tree.getByText('backup.scanNextcloudQr'));
  await act(() => tree.UNSAFE_getByType(Modal).props.onRequestClose());
  await act(() => tree.UNSAFE_getByType(Modal).props.onDismiss());

  expect(focus).not.toHaveBeenCalled();
});
