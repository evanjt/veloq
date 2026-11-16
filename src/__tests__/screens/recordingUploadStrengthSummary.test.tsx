/**
 * Scenario: a strength session's upload carries a plain-text summary of its sets in the
 * description, which the engine reads from `veloq-strength-summary` and treats as on unless "0".
 *
 * Expected behaviour: the upload settings screen shows the switch on when the setting is absent,
 * off when it is "0", and writes "0" and "1" as the athlete flips it.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';

import RecordingUploadScreen from '@/app/recording-upload';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/features/recording', () => ({
  useRecordingPreferences: Object.assign(
    (select: (s: unknown) => unknown) => select({ autoUploadEnabled: true }),
    { getState: () => ({ setAutoUpload: jest.fn() }) }
  ),
  UploadPermissionNotice: () => null,
}));

const mockSettings = new Map<string, string>();
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async (key: string) => mockSettings.get(key) ?? null),
  setSetting: jest.fn(async (key: string, value: string) => {
    mockSettings.set(key, value);
  }),
}));

beforeEach(() => mockSettings.clear());

describe('strength summary switch', () => {
  it('is on when the setting is absent', async () => {
    const screen = await render(<RecordingUploadScreen />);
    const row = await screen.findByTestId('settings-strength-summary');
    expect(row.props.accessibilityState.checked).toBe(true);
  });

  it('is off when the setting is "0"', async () => {
    mockSettings.set('veloq-strength-summary', '0');
    const screen = await render(<RecordingUploadScreen />);
    await waitFor(() =>
      expect(screen.getByTestId('settings-strength-summary').props.accessibilityState.checked).toBe(
        false
      )
    );
  });

  it('writes "0" when pressed off and "1" when pressed on again', async () => {
    const screen = await render(<RecordingUploadScreen />);
    const row = await screen.findByTestId('settings-strength-summary');
    fireEvent.press(row);
    await waitFor(() => expect(mockSettings.get('veloq-strength-summary')).toBe('0'));
    fireEvent.press(screen.getByTestId('settings-strength-summary'));
    await waitFor(() => expect(mockSettings.get('veloq-strength-summary')).toBe('1'));
  });
});
