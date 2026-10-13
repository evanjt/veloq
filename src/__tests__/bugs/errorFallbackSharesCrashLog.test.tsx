/**
 * Scenario: a screen or the whole app falls over, and the only way to send
 * the crash that caused it was a row deep in Settings, which the global
 * fallback cannot reach at all.
 *
 * Expected behaviour: the screen and global fallbacks each offer to share the
 * crash log, through the one share path Settings uses.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ScreenErrorBoundary } from '@/shared/ui/ScreenErrorBoundary';
import { GlobalErrorBoundary } from '@/shared/ui/GlobalErrorBoundary';
import { offerCrashLog, shareCrashLog } from '@/shared/app/supportLinks';

jest.mock('@/shared/debug/boundaryCrash', () => ({ recordBoundaryCrash: jest.fn() }));
jest.mock('@/shared/app/supportLinks', () => ({
  shareCrashLog: jest.fn(async () => {}),
  offerCrashLog: jest.fn(async () => {}),
}));
jest.mock('@/shared/app', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

function Broken(): React.ReactElement {
  throw new Error('render failed');
}

let consoleError: jest.SpyInstance;

beforeEach(() => {
  (shareCrashLog as jest.Mock).mockClear();
  (offerCrashLog as jest.Mock).mockClear();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(router, 'canGoBack').mockReturnValue(false);
});

afterEach(() => {
  consoleError.mockRestore();
  jest.restoreAllMocks();
});

describe('the error fallbacks', () => {
  it('offer the crash log on a screen that threw', async () => {
    const { getByTestId } = await render(
      <ScreenErrorBoundary screenName="Orchard">
        <Broken />
      </ScreenErrorBoundary>
    );

    await fireEvent.press(getByTestId('error-share-crash-log'));
    expect(offerCrashLog).toHaveBeenCalledTimes(1);
  });

  it('offer the crash log when the whole app threw', async () => {
    const { getByTestId } = await render(
      <GlobalErrorBoundary>
        <Broken />
      </GlobalErrorBoundary>
    );

    const button = getByTestId('error-share-crash-log');
    expect(button.props.accessibilityRole ?? button.props.role).toBe('button');
    await fireEvent.press(button);
    expect(shareCrashLog).toHaveBeenCalledTimes(1);
  });
});
