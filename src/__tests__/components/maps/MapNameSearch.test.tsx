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
import { formatShortDateWithYear } from '@/shared/format/format';
import { i18n, initialiseI18n } from '@/i18n';
import { spokenDistance } from '@/shared/format/spoken';
import { composeAccessibilityLabel } from '@/shared/ui/accessibilityLabel';
import type { ActivityBoundsItem } from '@/types';

let mockIsDark = false;
jest.mock('@/shared/app', () => {
  const { colors, darkColors } = jest.requireActual('@/theme');
  return {
    useTheme: () => ({ isDark: mockIsDark, colors: mockIsDark ? darkColors : colors }),
    useMetricSystem: () => true,
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
  it('reports typing and offers each match as a choice', async () => {
    const onChangeNeedle = jest.fn();
    const onChoose = jest.fn();
    await render(
      <MapNameSearch
        needle="vent"
        onChangeNeedle={onChangeNeedle}
        results={[ride('a1', 'Mont Ventoux'), ride('a2', 'Ventoux again')]}
        total={2}
        filters={[]}
        onChoose={onChoose}
      />
    );

    await fireEvent.changeText(screen.getByTestId('map-search-input'), 'ventoux');
    expect(onChangeNeedle).toHaveBeenCalledWith('ventoux');

    await fireEvent.press(screen.getByTestId('map-search-result-a2'));
    expect(onChoose).toHaveBeenCalledWith('a2');
    expect(
      screen.getAllByText(formatShortDateWithYear(new Date('2026-04-10T08:00:00Z')))
    ).toHaveLength(2);
  });

  it('shows no list without results and clears the field on request', async () => {
    const onChangeNeedle = jest.fn();
    await render(
      <MapNameSearch
        needle="x"
        onChangeNeedle={onChangeNeedle}
        results={[]}
        total={0}
        filters={[]}
        onChoose={jest.fn()}
      />
    );

    expect(screen.queryByTestId('map-search-results')).toBeNull();
    await fireEvent.press(screen.getByLabelText('common.clearSearch'));
    expect(onChangeNeedle).toHaveBeenCalledWith('');
  });

  it('offers no clear control for an empty field', async () => {
    await render(
      <MapNameSearch
        needle=""
        onChangeNeedle={jest.fn()}
        results={[]}
        total={0}
        filters={[]}
        onChoose={jest.fn()}
      />
    );

    expect(screen.queryByLabelText('common.clearSearch')).toBeNull();
  });

  it('draws the shared search bar, so input handling follows the app theme', async () => {
    mockIsDark = true;
    await render(
      <MapNameSearch
        needle=""
        onChangeNeedle={jest.fn()}
        results={[]}
        total={0}
        filters={[]}
        onChoose={jest.fn()}
      />
    );

    const input = screen.getByTestId('map-search-input');
    expect(input.props.autoCapitalize).toBe('none');
    expect(input.props.keyboardAppearance).toBe('dark');
    expect(screen.UNSAFE_getByType(SearchBar)).toBeTruthy();
  });

  it('shows a localised date with year in each result', async () => {
    await initialiseI18n('en-GB');
    const activity = { ...ride('a1', 'Morning ride'), date: '2026-10-05T07:00:00' };
    await render(
      <MapNameSearch
        needle="ride"
        onChangeNeedle={jest.fn()}
        results={[activity]}
        total={1}
        filters={[]}
        onChoose={jest.fn()}
      />
    );

    expect(screen.getByText(formatShortDateWithYear(new Date(activity.date)))).toBeTruthy();
    expect(screen.queryByText('2026-10-05')).toBeNull();
  });

  it('names each result with the date it draws beside the name', async () => {
    await initialiseI18n('en-GB');
    const activity = { ...ride('a3', 'Orchard spin'), date: '2026-06-14T09:00:00' };
    await render(
      <MapNameSearch
        needle="orchard"
        onChangeNeedle={jest.fn()}
        results={[activity]}
        total={1}
        filters={[]}
        onChoose={jest.fn()}
      />
    );

    expect(screen.getByTestId('map-search-result-a3').props.accessibilityLabel).toContain(
      formatShortDateWithYear(new Date(activity.date))
    );
  });
});

describe('MapNameSearch count and rows', () => {
  const six = Array.from({ length: 6 }, (_, i) => ({
    ...ride(`m${i}`, `Harbour loop ${i}`),
    distance: 42_300 + i * 1_000,
  }));

  it('states how many of the matches it shows and names the filters that narrowed them', async () => {
    await initialiseI18n('en-GB');
    await render(
      <MapNameSearch
        needle="harbour"
        onChangeNeedle={jest.fn()}
        results={six.slice(0, 5)}
        total={six.length}
        filters={['Ride', '10–50km']}
        onChoose={jest.fn()}
      />
    );

    const count = screen.getByTestId('map-search-count');
    expect(count).toHaveTextContent('5 of 6 · filtered by Ride, 10–50km');
    expect(screen.queryByTestId('map-search-result-m5')).toBeNull();
  });

  it('names no filter when none narrowed the matches', async () => {
    await initialiseI18n('en-GB');
    await render(
      <MapNameSearch
        needle="harbour"
        onChangeNeedle={jest.fn()}
        results={six.slice(0, 2)}
        total={2}
        filters={[]}
        onChoose={jest.fn()}
      />
    );

    expect(screen.getByTestId('map-search-count')).toHaveTextContent('2 of 2', { exact: true });
  });

  it('draws sport, distance and date on each row and says all of them', async () => {
    await initialiseI18n('en-GB');
    await render(
      <MapNameSearch
        needle="harbour"
        onChangeNeedle={jest.fn()}
        results={six.slice(0, 5)}
        total={six.length}
        filters={[]}
        onChoose={jest.fn()}
      />
    );

    const date = formatShortDateWithYear(new Date(six[0]!.date));
    expect(screen.getByText('42.3 km')).toBeTruthy();
    expect(
      screen.getByTestId('map-search-result-m0-icon', { includeHiddenElements: true })
    ).toBeTruthy();
    const label = screen.getByTestId('map-search-result-m0').props.accessibilityLabel;
    expect(label).toBe(
      composeAccessibilityLabel(
        'Harbour loop 0',
        i18n.t('sportFamilies.ride'),
        spokenDistance(42_300, true),
        date
      )
    );
    expect(label).toContain('42.3 kilometres');
  });
});
