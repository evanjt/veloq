/**
 * Scenario: a screen throws on the first tab after a cold start, so the root
 * stack holds nothing beneath it.
 *
 * Expected behaviour: the fallback offers Back only when the router has
 * history to go back to. Otherwise Back is absent and Retry still works.
 */

import React from 'react';
import { render, fireEvent } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ScreenErrorBoundary } from '@/shared/ui/ScreenErrorBoundary';

jest.mock('@/shared/debug/crashLog', () => ({
  ...jest.requireActual('@/shared/debug/crashLog'),
  recordCrash: jest.fn(),
}));
jest.mock('@/shared/app', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

let failing = true;

function Broken() {
  const { Text } = require('react-native');
  if (failing) throw new Error('render failed');
  return <Text>loaded</Text>;
}

let consoleError: jest.SpyInstance;
let canGoBack: jest.SpyInstance;

beforeEach(() => {
  failing = true;
  (router.back as jest.Mock).mockClear();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  canGoBack = jest.spyOn(router, 'canGoBack');
});

afterEach(() => {
  consoleError.mockRestore();
  canGoBack.mockRestore();
});

describe('the screen error fallback Back button', () => {
  it('is absent when the router has no history, and Retry still works', () => {
    canGoBack.mockReturnValue(false);
    const { getByText, queryByText } = render(
      <ScreenErrorBoundary>
        <Broken />
      </ScreenErrorBoundary>
    );

    expect(queryByText('common.back')).toBeNull();
    failing = false;
    fireEvent.press(getByText('common.retry'));
    expect(getByText('loaded')).toBeTruthy();
  });

  it('goes back when the router has history', () => {
    canGoBack.mockReturnValue(true);
    const { getByText } = render(
      <ScreenErrorBoundary>
        <Broken />
      </ScreenErrorBoundary>
    );

    fireEvent.press(getByText('common.back'));
    expect(router.back).toHaveBeenCalledTimes(1);
  });
});
