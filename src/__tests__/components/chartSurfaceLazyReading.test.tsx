/**
 * Scenario: a chart hands ChartSurface a reading to build on demand, because the spoken
 * summary and the Show data table cost a formatted label per plotted day.
 *
 * Expected behaviour: nothing is built while the chart draws with no screen reader and the sheet
 * closed; the summary is built when a screen reader is on, and the table when Show data opens.
 */

import React from 'react';
import { AccessibilityInfo, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { ChartSurface } from '@/shared/charts/ChartSurface';

const mockOpenSheet = jest.fn();
jest.mock('@/shared/app/sheetRequest', () => ({
  useSheetOpener: () => mockOpenSheet,
}));

const table = {
  title: 'Form',
  columns: ['Date', 'Form'],
  rows: [{ key: 'a', cells: ['1 Jan', '4'] }],
};

function lazy() {
  return {
    hasRows: true,
    read: jest.fn(() => ({ summary: 'Form chart.', table })),
  };
}

describe('ChartSurface lazy reading', () => {
  beforeEach(() => {
    mockOpenSheet.mockClear();
  });

  it('builds nothing on render without a screen reader', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const reading = lazy();
    render(
      <ChartSurface reading={reading}>
        <View />
      </ChartSurface>
    );
    await act(async () => {});
    expect(reading.read).not.toHaveBeenCalled();
  });

  vaultIt('builds the summary when a screen reader is on', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(true);
    const reading = lazy();
    const tree = render(
      <ChartSurface reading={reading}>
        <View />
      </ChartSurface>
    );
    await act(async () => {});
    expect(tree.getByRole('image').props.accessibilityLabel).toBe('Form chart');
  });

  it('builds the table when Show data is pressed, and offers none without rows', async () => {
    jest.spyOn(AccessibilityInfo, 'isScreenReaderEnabled').mockResolvedValue(false);
    const reading = lazy();
    const tree = render(
      <ChartSurface reading={reading} testID="plot">
        <View />
      </ChartSurface>
    );
    await act(async () => {});
    fireEvent.press(tree.getByTestId('plot-show-data'));
    expect(reading.read).toHaveBeenCalledTimes(1);
    expect(mockOpenSheet).toHaveBeenCalledWith('sheets/chart-data', table);

    const empty = render(
      <ChartSurface reading={{ hasRows: false, read: jest.fn() }} testID="none">
        <View />
      </ChartSurface>
    );
    expect(empty.queryByTestId('none-show-data')).toBeNull();
  });
});
