/**
 * Scenario: a screen reader user focuses the range handles and swipes up or down.
 * Expected behaviour: each handle is an adjustable element whose action steps its date by one
 * calendar month and reports it through onRangeChange; a step that would shrink an
 * expand-only range, or leave the track, changes nothing.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { TimelineSlider } from '@/features/maps/components/timeline/TimelineSlider';

jest.mock('expo-haptics', () => ({
  ...jest.requireActual('expo-haptics'),
  impactAsync: jest.fn(),
}));

const minDate = new Date(2020, 0, 1);
const maxDate = new Date(2026, 0, 1);
const endDate = new Date(2026, 0, 1);

function setup(props: { startDate?: Date; expandOnly?: boolean; fixedEnd?: boolean } = {}) {
  const onRangeChange = jest.fn();
  const view = render(
    <TimelineSlider
      minDate={minDate}
      maxDate={maxDate}
      startDate={props.startDate ?? new Date(2024, 2, 31)}
      endDate={endDate}
      onRangeChange={onRangeChange}
      expandOnly={props.expandOnly ?? false}
      fixedEnd={props.fixedEnd ?? false}
    />
  );
  const act = (testID: string, actionName: 'increment' | 'decrement') =>
    fireEvent(view.getByTestId(testID), 'accessibilityAction', { nativeEvent: { actionName } });
  return { view, onRangeChange, act };
}

describe('TimelineSlider accessibility', () => {
  it('exposes the start handle as an adjustable element with the date as its value', () => {
    const { view } = setup();
    const handle = view.getByTestId('timeline-slider-start-handle');
    expect(handle.props.accessible).toBe(true);
    expect(handle.props.accessibilityRole).toBe('adjustable');
    expect(handle.props.accessibilityLabel).toBeTruthy();
    expect(handle.props.accessibilityValue.text).toMatch(/2024/);
    expect(handle.props.accessibilityActions).toEqual([
      { name: 'increment' },
      { name: 'decrement' },
    ]);
  });

  it('decrement moves the start one month earlier, clamping the day to the month length', () => {
    const { onRangeChange, act } = setup();
    act('timeline-slider-start-handle', 'decrement');
    expect(onRangeChange).toHaveBeenCalledTimes(1);
    const [start, end] = onRangeChange.mock.calls[0];
    expect(start).toEqual(new Date(2024, 1, 29));
    expect(end).toEqual(endDate);
  });

  it('increment moves the start one month later when the range is not expand-only', () => {
    const { onRangeChange, act } = setup({ startDate: new Date(2024, 0, 15) });
    act('timeline-slider-start-handle', 'increment');
    expect(onRangeChange.mock.calls[0][0]).toEqual(new Date(2024, 1, 15));
  });

  it('increment is a no-op when the range is expand-only', () => {
    const { onRangeChange, act } = setup({ expandOnly: true });
    act('timeline-slider-start-handle', 'increment');
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it('decrement stops at the oldest date on the track', () => {
    const { onRangeChange, act } = setup({ startDate: minDate, expandOnly: true });
    act('timeline-slider-start-handle', 'decrement');
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it('decrement lands on the oldest date when less than a month remains', () => {
    const { onRangeChange, act } = setup({ startDate: new Date(2020, 0, 20) });
    act('timeline-slider-start-handle', 'decrement');
    expect(onRangeChange.mock.calls[0][0]).toEqual(minDate);
  });

  it('increment never carries the start to or past the end', () => {
    const { onRangeChange, act } = setup({ startDate: new Date(2025, 11, 20) });
    act('timeline-slider-start-handle', 'increment');
    expect(onRangeChange).not.toHaveBeenCalled();
  });

  it('adjusts the end handle when it is not fixed', () => {
    const { view, onRangeChange, act } = setup({ startDate: new Date(2024, 0, 1) });
    expect(view.getByTestId('timeline-slider-end-handle').props.accessibilityRole).toBe(
      'adjustable'
    );
    act('timeline-slider-end-handle', 'decrement');
    expect(onRangeChange.mock.calls[0][1]).toEqual(new Date(2025, 11, 1));
    act('timeline-slider-end-handle', 'increment');
    expect(onRangeChange).toHaveBeenCalledTimes(1);
  });

  it('leaves a fixed end handle out of the accessibility tree actions', () => {
    const { view } = setup({ fixedEnd: true });
    expect(view.queryByTestId('timeline-slider-end-handle')).toBeNull();
  });
});
