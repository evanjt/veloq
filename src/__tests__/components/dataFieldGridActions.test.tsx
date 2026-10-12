/**
 * Scenario: a screen reader user wants to change a live data field. The only
 * way in is a hold on the tile, which nothing announces.
 * Expected behaviour: each tile offers a change-field action that opens the
 * same picker the hold does, a tile that does nothing on tap is not a button,
 * and a locked screen offers no action.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { DataFieldGrid } from '@/features/recording/components/DataFieldGrid';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const METRICS = {
  speed: 5,
  avgSpeed: 5,
  distance: 1000,
  heartrate: 0,
  power: 210,
  cadence: 0,
  elevation: 450,
  elevationGain: 20,
  calories: 10,
  lapDistance: 1000,
  lapTime: 200,
  elapsedTime: 200,
  movingTime: 200,
};

function renderGrid(onLongPressField?: (index: number, field: string) => void) {
  return render(
    <DataFieldGrid
      fields={['heartrate', 'power', 'speed']}
      metrics={METRICS}
      isMetric
      onEmptySensorTap={onLongPressField ? jest.fn() : undefined}
      onLongPressField={onLongPressField}
    />
  );
}

it('offers a change-field action on a filled tile that is not a button', () => {
  const onLongPressField = jest.fn();
  const tree = renderGrid(onLongPressField);
  const power = tree.getByTestId('data-field-power');

  expect(power.props.accessibilityRole).not.toBe('button');
  expect(power.props.accessibilityLabel).toBe('recording.fields.power, 210 W');
  expect(power.props.accessibilityActions).toEqual([
    { name: 'changeField', label: 'recording.changeField' },
  ]);

  fireEvent(power, 'accessibilityAction', { nativeEvent: { actionName: 'changeField' } });
  expect(onLongPressField).toHaveBeenCalledWith(1, 'power');
});

it('keeps the button role on an empty sensor tile, which a tap pairs', () => {
  const tree = renderGrid(jest.fn());
  const heartrate = tree.getByTestId('data-field-heartrate');

  expect(heartrate.props.accessibilityRole).toBe('button');
  expect(heartrate.props.accessibilityActions).toEqual([
    { name: 'changeField', label: 'recording.changeField' },
  ]);
});

it('offers no action on a locked screen', () => {
  const tree = renderGrid(undefined);

  for (const field of ['heartrate', 'power', 'speed']) {
    expect(tree.getByTestId(`data-field-${field}`).props.accessibilityActions).toBeUndefined();
  }
});
