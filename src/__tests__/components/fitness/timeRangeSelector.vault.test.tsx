/**
 * Scenario: the fitness range pair was drawn on a bare `TouchableOpacity` with
 * no role and the chosen range in colour only, so a screen reader could not
 * tell the ranges from text or which one was chosen.
 *
 * Expected behaviour: each range is a button that reports `selected` on its
 * state, exactly one at a time, and keeps its `fitness-range-<id>` testID.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { TimeRangeSelector } from '@/features/fitness/components/TimeRangeSelector';
import { TIME_RANGES } from '@/shared/app/constants';

describe('TimeRangeSelector', () => {
  it('exposes every range as a button and marks only the chosen one selected', async () => {
    await render(<TimeRangeSelector timeRange="3m" onTimeRangeChange={() => {}} isDark={false} />);

    for (const range of TIME_RANGES) {
      const button = screen.getByRole('button', { name: range.labelKey });
      expect(button.props.accessibilityState).toMatchObject({ selected: range.id === '3m' });
      expect(screen.getByTestId(`fitness-range-${range.id}`)).toBeTruthy();
    }
  });

  it('reports the range that was pressed', async () => {
    const onTimeRangeChange = jest.fn();
    await render(
      <TimeRangeSelector timeRange="3m" onTimeRangeChange={onTimeRangeChange} isDark={false} />
    );

    await fireEvent.press(screen.getByTestId('fitness-range-1y'));

    expect(onTimeRangeChange).toHaveBeenCalledWith('1y');
  });
});
