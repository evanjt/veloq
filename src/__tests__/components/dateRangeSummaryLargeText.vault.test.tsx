/**
 * Scenario: the routes and insights date-range header is pinned above the tabs.
 * At the largest system text the count and dates sat in a column a few
 * characters wide, because the expand button kept its label's width beside
 * them, and the header filled the window.
 *
 * Expected behaviour: at the dense cap and below, the count and dates sit
 * beside the expand button. Past the cap the button drops under them, so the
 * text takes the full width of the row.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import { DateRangeSummary } from '@/features/routes/components/DateRangeSummary';
import { DENSE_TEXT_SCALE } from '@/shared/ui';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

let mockFontScale = 1;
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ width: 390, height: 844, scale: 3, fontScale: mockFontScale }),
}));

const SUMMARY = 'routes-date-range-summary';

const summary = {
  activityCount: 318,
  oldestDate: '2025-11-03',
  newestDate: '2026-11-02',
};

function layoutAt(fontScale: number): string | undefined {
  mockFontScale = fontScale;
  render(<DateRangeSummary {...summary} />);
  const direction = StyleSheet.flatten(screen.getByTestId(SUMMARY).props.style)?.flexDirection;
  screen.unmount();
  return direction;
}

describe('DateRangeSummary at large text', () => {
  afterEach(() => {
    mockFontScale = 1;
  });

  it('keeps the count, dates and button in one row at the default size', () => {
    expect(layoutAt(1)).toBe('row');
  });

  it('keeps the row at the dense cap, which still counts as normal text', () => {
    expect(layoutAt(DENSE_TEXT_SCALE)).toBe('row');
  });

  it('stacks the button under the count and dates just past the cap', () => {
    expect(layoutAt(DENSE_TEXT_SCALE + 0.01)).toBe('column');
  });

  it('stacks the button under the count and dates at the largest size', () => {
    expect(layoutAt(3.57)).toBe('column');
  });
});
