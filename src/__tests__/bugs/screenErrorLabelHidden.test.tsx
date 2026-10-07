/**
 * Scenario: a screen throws and its boundary carries a developer label.
 *
 * Expected behaviour: the label never shows in the fallback and still reaches
 * the crash log as the screen.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { ScreenErrorBoundary } from '@/shared/ui/ScreenErrorBoundary';
import { recordBoundaryCrash } from '@/shared/debug/boundaryCrash';

jest.mock('@/shared/debug/boundaryCrash', () => ({ recordBoundaryCrash: jest.fn() }));

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

describe('the screen error fallback label', () => {
  it('is not shown, while the crash log still receives it', () => {
    canGoBack.mockReturnValue(false);
    const { queryByText, getByText } = render(
      <ScreenErrorBoundary screenName="BackupSettings">
        <Broken />
      </ScreenErrorBoundary>
    );

    expect(getByText('emptyState.error.title')).toBeTruthy();
    expect(queryByText('BackupSettings')).toBeNull();
    expect(recordBoundaryCrash).toHaveBeenCalledWith(
      expect.any(Error),
      expect.anything(),
      expect.objectContaining({ screen: 'BackupSettings' })
    );
  });
});
