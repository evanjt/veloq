/**
 * Scenario: the routes and sections lists drew one chip per sport, which took a
 * whole row once an athlete had several sports.
 *
 * Expected behaviour: one control names the sport the list is narrowed to, and
 * pressing it opens the choice, each sport with its count. Choosing the sport
 * already selected, or "All sports", hands the choice back to the list.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SportFilterMenu } from '@/features/routes/components/SportFilterMenu';

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

const options = [
  { type: 'Ride', count: 12 },
  { type: 'Run', count: 3 },
];

describe('SportFilterMenu', () => {
  it('shows one trigger and keeps the options closed until it is pressed', () => {
    const { getByTestId, queryByTestId } = render(
      <SportFilterMenu options={options} selectedType={undefined} onSelect={jest.fn()} />
    );

    expect(getByTestId('sport-filter-trigger')).toBeTruthy();
    expect(queryByTestId('sport-filter-option-Ride')).toBeNull();
  });

  it('names the selected sport on the trigger', () => {
    const { getByTestId } = render(
      <SportFilterMenu options={options} selectedType="Run" onSelect={jest.fn()} />
    );

    expect(getByTestId('sport-filter-trigger').props.accessibilityLabel).toContain('Run');
  });

  it('lists every sport with its count once opened, and picks one', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <SportFilterMenu options={options} selectedType={undefined} onSelect={onSelect} />
    );

    fireEvent.press(getByTestId('sport-filter-trigger'));

    expect(getByTestId('sport-filter-option-Ride').props.accessibilityLabel).toContain('12');
    fireEvent.press(getByTestId('sport-filter-option-Run'));
    expect(onSelect).toHaveBeenCalledWith('Run');
  });

  it('closes after a choice', () => {
    const { getByTestId, queryByTestId } = render(
      <SportFilterMenu options={options} selectedType={undefined} onSelect={jest.fn()} />
    );

    fireEvent.press(getByTestId('sport-filter-trigger'));
    fireEvent.press(getByTestId('sport-filter-option-Run'));

    expect(queryByTestId('sport-filter-option-Run')).toBeNull();
  });

  it('clears the filter from the all-sports row, and marks the selected sport', () => {
    const onSelect = jest.fn();
    const { getByTestId } = render(
      <SportFilterMenu options={options} selectedType="Run" onSelect={onSelect} />
    );

    fireEvent.press(getByTestId('sport-filter-trigger'));
    expect(getByTestId('sport-filter-option-Run').props.accessibilityState.selected).toBe(true);
    expect(getByTestId('sport-filter-option-Ride').props.accessibilityState.selected).toBe(false);

    fireEvent.press(getByTestId('sport-filter-option-all'));
    expect(onSelect).toHaveBeenCalledWith(undefined);
  });

  it('keeps a selected sport that has dropped out of the options reachable', () => {
    const { getByTestId } = render(
      <SportFilterMenu options={[{ type: 'Ride' }]} selectedType="Swim" onSelect={jest.fn()} />
    );

    fireEvent.press(getByTestId('sport-filter-trigger'));
    expect(getByTestId('sport-filter-option-Swim')).toBeTruthy();
  });
});
