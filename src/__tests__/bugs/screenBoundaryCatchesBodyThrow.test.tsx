/**
 * Scenario: a hook in a screen's own body throws on render.
 *
 * Expected behaviour: the screen fallback with Retry and Back renders, and
 * Retry remounts the screen. A boundary rendered inside the screen's return
 * is skipped, and the throw reaches the global fallback that has no button.
 */

import React from 'react';
import { router } from 'expo-router';
import { render, fireEvent } from '@testing-library/react-native';

import { withScreenBoundary } from '@/shared/ui/withScreenBoundary';

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

function useBrokenData(): string {
  if (failing) throw new Error('derivation failed');
  return 'loaded';
}

function BrokenScreen() {
  const { Text } = require('react-native');
  return <Text>{useBrokenData()}</Text>;
}

let consoleError: jest.SpyInstance;
let canGoBack: jest.SpyInstance;

beforeEach(() => {
  failing = true;
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(true);
});

afterEach(() => {
  consoleError.mockRestore();
  canGoBack.mockRestore();
});

describe('withScreenBoundary', () => {
  it('shows the screen fallback when the screen body throws', () => {
    const Screen = withScreenBoundary(BrokenScreen, 'Feed');
    const { getByText, queryByText } = render(<Screen />);

    expect(getByText('common.retry')).toBeTruthy();
    expect(getByText('common.back')).toBeTruthy();
    expect(queryByText('loaded')).toBeNull();
  });

  it('remounts the screen on Retry', () => {
    const Screen = withScreenBoundary(BrokenScreen, 'Feed');
    const { getByText } = render(<Screen />);

    failing = false;
    fireEvent.press(getByText('common.retry'));

    expect(getByText('loaded')).toBeTruthy();
  });

  it('passes props through', () => {
    const Echo = ({ label }: { label: string }) => {
      const { Text } = require('react-native');
      return <Text>{label}</Text>;
    };
    const Screen = withScreenBoundary(Echo, 'Echo');
    expect(render(<Screen label="hello" />).getByText('hello')).toBeTruthy();
  });
});
