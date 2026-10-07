/**
 * Scenario: the athlete types part of a ride's name over the map.
 *
 * Expected behaviour: each match is one tap to choose, typing reports the
 * text, and the clear control empties the field.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SearchBar } from '@/shared/ui';
import { MapNameSearch } from '@/features/maps/components/MapNameSearch';
import type { ActivityBoundsItem } from '@/types';

let mockIsDark = false;
jest.mock('@/shared/app', () => {
  const { colors, darkColors } = jest.requireActual('@/theme');
  return {
    useTheme: () => ({ isDark: mockIsDark, colors: mockIsDark ? darkColors : colors }),
  };
});

beforeEach(() => {
  mockIsDark = false;
});

const ride = (id: string, name: string): ActivityBoundsItem => ({
  id,
  bounds: [
    [44.1, 5.2],
    [44.2, 5.3],
  ],
  type: 'Ride',
  name,
  date: '2026-04-10T08:00:00Z',
  distance: 60_000,
  duration: 12_000,
});

describe('MapNameSearch', () => {
  it('reports typing and offers each match as a choice', () => {
    const onChangeNeedle = jest.fn();
    const onChoose = jest.fn();
    render(
      <MapNameSearch
        needle="vent"
        onChangeNeedle={onChangeNeedle}
        results={[ride('a1', 'Mont Ventoux'), ride('a2', 'Ventoux again')]}
        onChoose={onChoose}
      />
    );

    fireEvent.changeText(screen.getByTestId('map-search-input'), 'ventoux');
    expect(onChangeNeedle).toHaveBeenCalledWith('ventoux');

    fireEvent.press(screen.getByTestId('map-search-result-a2'));
    expect(onChoose).toHaveBeenCalledWith('a2');
    expect(screen.getAllByText('2026-04-10')).toHaveLength(2);
  });

  it('shows no list without results and clears the field on request', () => {
    const onChangeNeedle = jest.fn();
    render(
      <MapNameSearch needle="x" onChangeNeedle={onChangeNeedle} results={[]} onChoose={jest.fn()} />
    );

    expect(screen.queryByTestId('map-search-results')).toBeNull();
    fireEvent.press(screen.getByLabelText('common.clearSearch'));
    expect(onChangeNeedle).toHaveBeenCalledWith('');
  });

  it('offers no clear control for an empty field', () => {
    render(
      <MapNameSearch needle="" onChangeNeedle={jest.fn()} results={[]} onChoose={jest.fn()} />
    );

    expect(screen.queryByLabelText('common.clearSearch')).toBeNull();
  });

  it('draws the shared search bar, so input handling follows the app theme', () => {
    mockIsDark = true;
    render(
      <MapNameSearch needle="" onChangeNeedle={jest.fn()} results={[]} onChoose={jest.fn()} />
    );

    const input = screen.getByTestId('map-search-input');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.keyboardAppearance).toBe('dark');
    expect(screen.UNSAFE_getByType(SearchBar)).toBeTruthy();
  });
});
