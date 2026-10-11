/**
 * Scenario: a ride is recording with no power meter or strap connected.
 * Expected behaviour: tapping an empty heart rate, power or cadence tile asks
 * to open sensor pairing for that kind; a tile with a value, or any other
 * tile, does nothing on tap, and the long press still reaches the field picker.
 */

import React from 'react';
import { act, render, fireEvent } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const METRICS = {
  speed: 5,
  avgSpeed: 5,
  distance: 1000,
  heartrate: 0,
  power: 0,
  cadence: 0,
  elevation: 450,
  elevationGain: 20,
  calories: 10,
  lapDistance: 1000,
  lapTime: 200,
  elapsedTime: 200,
  movingTime: 200,
};

function renderGrid(metrics = METRICS) {
  const onEmptySensorTap = jest.fn();
  const onLongPressField = jest.fn();
  const tree = render(
    <DataFieldGrid
      fields={['heartrate', 'power', 'cadence', 'speed']}
      metrics={metrics}
      isMetric
      onEmptySensorTap={onEmptySensorTap}
      onLongPressField={onLongPressField}
    />
  );
  return { tree, onEmptySensorTap, onLongPressField };
}

it.each([
  ['heartrate', 'heartRate'],
  ['power', 'power'],
  ['cadence', 'cadence'],
])('opens pairing for %s when the tile is empty', (field, kind) => {
  const { tree, onEmptySensorTap } = renderGrid();
  fireEvent.press(tree.getByTestId(`data-field-${field}`));
  expect(onEmptySensorTap).toHaveBeenCalledWith(kind);
});

it('does nothing on a tap when the sensor tile has a value', () => {
  const { tree, onEmptySensorTap } = renderGrid({ ...METRICS, heartrate: 140, power: 200 });
  fireEvent.press(tree.getByTestId('data-field-heartrate'));
  fireEvent.press(tree.getByTestId('data-field-power'));
  expect(onEmptySensorTap).not.toHaveBeenCalled();
});

it('does nothing on a tap for a non-sensor tile', () => {
  const { tree, onEmptySensorTap } = renderGrid();
  fireEvent.press(tree.getByTestId('data-field-speed'));
  expect(onEmptySensorTap).not.toHaveBeenCalled();
});

it('announces a tile as a button only when a tap does something', () => {
  const { tree } = renderGrid({ ...METRICS, power: 200 });
  expect(tree.getByTestId('data-field-heartrate').props.accessibilityRole).toBe('button');
  expect(tree.getByTestId('data-field-power').props.accessibilityRole).toBeUndefined();
  expect(tree.getByTestId('data-field-speed').props.accessibilityRole).toBeUndefined();
});

it('keeps the long press on an empty sensor tile for the field picker', () => {
  const { tree, onEmptySensorTap, onLongPressField } = renderGrid();
  fireEvent(tree.getByTestId('data-field-power'), 'longPress');
  expect(onLongPressField).toHaveBeenCalledWith(1, 'power');
  expect(onEmptySensorTap).not.toHaveBeenCalled();
});

it('waits through a riding bump before opening the field picker', () => {
  jest.useFakeTimers();
  try {
    const { tree, onLongPressField } = renderGrid();
    fireEvent(tree.getByTestId('data-field-power'), 'onResponderGrant', {
      persist: jest.fn(),
      nativeEvent: { pageX: 0, pageY: 0, locationX: 0, locationY: 0, timestamp: 0 },
    });
    act(() => jest.advanceTimersByTime(400));
    expect(onLongPressField).not.toHaveBeenCalled();
    act(() => jest.advanceTimersByTime(100));
    expect(onLongPressField).toHaveBeenCalledWith(1, 'power');
  } finally {
    jest.useRealTimers();
  }
});
