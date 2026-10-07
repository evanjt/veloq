/**
 * Scenario: the retired sections screen reads the ledger in its own body and
 * the read throws.
 *
 * Expected behaviour: the screen fallback with Retry and Back renders, and
 * Retry reads again. The boundary sat inside the screen's return, so a throw
 * in the body skipped it and reached the global fallback, which has no button.
 */

import React from 'react';
import { router } from 'expo-router';
import { fireEvent, render } from '@testing-library/react-native';

import SectionRetiredScreen from '@/app/section-retired';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { text: '#000', textSecondary: '#666' } }),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
}));

jest.mock('@/features/routes/lib/sectionDisplayNames', () => ({
  getAllSectionDisplayNames: () => ({}),
}));

const mockGetRetiredSections = jest.fn<unknown[], []>();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    subscribe: () => () => {},
    getRetiredSections: () => mockGetRetiredSections(),
  }),
}));

let consoleError: jest.SpyInstance;
let canGoBack: jest.SpyInstance;

beforeEach(() => {
  jest.clearAllMocks();
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  canGoBack = jest.spyOn(router, 'canGoBack').mockReturnValue(true);
});

afterEach(() => {
  consoleError.mockRestore();
  canGoBack.mockRestore();
});

describe('a throw in a screen body', () => {
  it('reaches the screen fallback with Retry and Back', () => {
    mockGetRetiredSections.mockImplementation(() => {
      throw new Error('ledger read failed');
    });

    const { getByText, queryByTestId } = render(<SectionRetiredScreen />);

    expect(getByText('common.retry')).toBeTruthy();
    expect(getByText('common.back')).toBeTruthy();
    expect(queryByTestId('section-retired-list')).toBeNull();
  });

  it('reads again and renders the screen after Retry', () => {
    let failing = true;
    mockGetRetiredSections.mockImplementation(() => {
      if (failing) throw new Error('ledger read failed');
      return [];
    });

    const { getByText, getByTestId } = render(<SectionRetiredScreen />);
    failing = false;
    fireEvent.press(getByText('common.retry'));

    expect(getByTestId('section-retired-list')).toBeTruthy();
  });
});
