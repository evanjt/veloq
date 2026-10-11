/**
 * Scenario: a screen throws on every render. On a tab, replacing to the Feed
 * would land on the screen that threw, so Back there needs history beneath it.
 * Outside the tabs a screen with no history, as one a cold link opened, can
 * still leave for the Feed.
 *
 * Expected behaviour: on a tab the fallback offers Back only with history, and
 * Retry still works without it. Outside the tabs Back is always offered, and
 * with no history it replaces to the Feed.
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
let segments: jest.SpyInstance;

beforeEach(() => {
  failing = true;
  (router.back as jest.Mock).mockClear();
  (router.replace as jest.Mock).mockClear();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  canGoBack = jest.spyOn(router, 'canGoBack');
  segments = jest
    .spyOn(jest.requireMock('expo-router'), 'useSegments')
    .mockReturnValue(['(tabs)'] as never);
});

afterEach(() => {
  consoleError.mockRestore();
  canGoBack.mockRestore();
  segments.mockRestore();
});

describe('the screen error fallback Back button on a tab', () => {
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

describe('the screen error fallback Back button outside the tabs', () => {
  beforeEach(() => {
    segments.mockReturnValue(['section', '[id]'] as never);
  });

  it('is offered with no history and replaces to the Feed', () => {
    canGoBack.mockReturnValue(false);
    const { getByText } = render(
      <ScreenErrorBoundary>
        <Broken />
      </ScreenErrorBoundary>
    );

    fireEvent.press(getByText('common.back'));
    expect(router.back).not.toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith('/');
  });

  it('pops when the router has history', () => {
    canGoBack.mockReturnValue(true);
    const { getByText } = render(
      <ScreenErrorBoundary>
        <Broken />
      </ScreenErrorBoundary>
    );

    fireEvent.press(getByText('common.back'));
    expect(router.back).toHaveBeenCalledTimes(1);
    expect(router.replace).not.toHaveBeenCalled();
  });
});
