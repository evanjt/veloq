/**
 * Scenario: an athlete taps an activity, a section and a route on the map.
 * Expected behaviour: all three open the same card, with the same action
 * wording, and every figure says what it measures: the activity's time is its
 * moving time, and the route shows its distance.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen, within } from '@testing-library/react-native';

import {
  ActivityPopup,
  type SelectedActivity,
} from '@/features/maps/components/regional/ActivityPopup';
import { SectionPopup } from '@/features/maps/components/regional/SectionPopup';
import { RoutePopup } from '@/features/maps/components/regional/RoutePopup';
import { initialiseI18n } from '@/i18n';
import type { FrequentSection } from '@/types';

jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

const SELECTED: SelectedActivity = {
  activity: {
    id: 'lantern-walk',
    bounds: [
      [46.1, 7.1],
      [46.2, 7.2],
    ],
    type: 'Ride',
    name: 'Lantern walk',
    date: '2026-10-01T09:00:00Z',
    distance: 12000,
    duration: 1800,
  },
  mapData: null,
  isLoading: false,
};

const SECTION = {
  id: 'quarry',
  sectionType: 'auto',
  name: 'Quarry climb',
  sportTypes: ['Run'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1', 'a2'],
  routeIds: ['r1'],
  visitCount: 2,
  createdAt: '2026-01-01T00:00:00Z',
} as FrequentSection;

beforeAll(async () => {
  await initialiseI18n();
});

describe('map popups', () => {
  it('render the activity through the shared card, its time labelled as moving time', async () => {
    await render(
      <ActivityPopup
        selected={SELECTED}
        bottom={0}
        onZoom={jest.fn()}
        onClose={jest.fn()}
        onViewDetails={jest.fn()}
      />
    );
    const card = within(screen.getByTestId('activity-popup'));
    expect(card.getByTestId('map-popup-stats')).toBeTruthy();
    expect(card.getByText('Moving time: 30:00')).toBeTruthy();
    expect(card.getByText('View details')).toBeTruthy();
  });

  it('keep half the header for the title and date, and wrap the actions below rather than break a word', async () => {
    await render(
      <ActivityPopup
        selected={SELECTED}
        bottom={0}
        onZoom={jest.fn()}
        onClose={jest.fn()}
        onViewDetails={jest.fn()}
      />
    );
    const info = screen.getByTestId('map-popup-title-block');
    expect(info).toHaveStyle({ flex: 1, minWidth: '50%' });
    expect(screen.getByTestId('map-popup-header')).toHaveStyle({ flexWrap: 'wrap' });
    const action = StyleSheet.flatten(
      screen.getByTestId('activity-popup-view-details').props.style
    );
    expect(action.maxWidth).toBe('100%');
    expect(action.flexShrink).toBeUndefined();
  });

  it('render the section through the shared card', async () => {
    await render(
      <SectionPopup section={SECTION} bottom={0} onClose={jest.fn()} onViewDetails={jest.fn()} />
    );
    const card = within(screen.getByTestId('section-popup'));
    expect(card.getByTestId('map-popup-stats')).toBeTruthy();
    expect(card.getByText('View details')).toBeTruthy();
    expect(card.getByText('2 traversals · 1.2 km')).toBeTruthy();
  });

  it('render the route through the shared card, with the distance the engine read', async () => {
    await render(
      <RoutePopup
        route={{
          routeId: 'canal-loop',
          name: 'Canal loop',
          activityCount: 4,
          distanceMeters: 8400,
        }}
        bottom={0}
        onClose={jest.fn()}
        onViewDetails={jest.fn()}
      />
    );
    const card = within(screen.getByTestId('route-popup'));
    expect(card.getByTestId('map-popup-stats')).toBeTruthy();
    expect(card.getByText('View details')).toBeTruthy();
    expect(card.getByText('8.4 km')).toBeTruthy();
  });
});
