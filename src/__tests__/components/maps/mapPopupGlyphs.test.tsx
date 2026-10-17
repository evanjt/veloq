/**
 * Scenario: an athlete taps an activity, a ride-only section and a ride-only
 * route on the map.
 * Expected behaviour: the activity's zoom action draws the fit glyph, not the
 * crosshair that means "my location", and no activity count draws a sport's
 * figure.
 */

import React from 'react';
import { render, screen, within } from '@testing-library/react-native';

import {
  ActivityPopup,
  type SelectedActivity,
} from '@/features/maps/components/regional/ActivityPopup';
import { SectionPopup } from '@/features/maps/components/regional/SectionPopup';
import { RoutePopup } from '@/features/maps/components/regional/RoutePopup';
import { ACTIVITY_COUNT_GLYPH, FIT_GLYPH, LOCATE_GLYPH } from '@/features/maps/lib/mapGlyphs';
import { initialiseI18n } from '@/i18n';
import type { FrequentSection } from '@/types';

jest.mock('@expo/vector-icons', () => {
  const { View } = jest.requireActual('react-native');
  return {
    MaterialCommunityIcons: ({ name }: { name: string }) => <View testID={`glyph-${name}`} />,
  };
});
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

const SELECTED: SelectedActivity = {
  activity: {
    id: 'harbour-spin',
    bounds: [
      [46.1, 7.1],
      [46.2, 7.2],
    ],
    type: 'Ride',
    name: 'Harbour spin',
    date: '2026-10-01T09:00:00Z',
    distance: 12000,
    duration: 1800,
  },
  mapData: null,
  isLoading: false,
};

const RIDE_SECTION = {
  id: 'orchard-drag',
  sectionType: 'auto',
  name: 'Orchard drag',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1', 'a2', 'a3'],
  routeIds: ['r1'],
  visitCount: 3,
  createdAt: '2026-01-01T00:00:00Z',
} as FrequentSection;

const runGlyphs = () => screen.queryAllByTestId('glyph-run');

beforeAll(async () => {
  await initialiseI18n();
});

describe('map popup glyphs', () => {
  it('draw the activity zoom with the fit glyph, never the locate crosshair', async () => {
    await render(
      <ActivityPopup
        selected={SELECTED}
        bottom={0}
        onZoom={jest.fn()}
        onClose={jest.fn()}
        onViewDetails={jest.fn()}
      />
    );
    const zoom = within(screen.getByTestId('activity-popup-zoom'));
    expect(zoom.queryByTestId(`glyph-${LOCATE_GLYPH}`)).toBeNull();
    expect(zoom.getByTestId(`glyph-${FIT_GLYPH}`)).toBeTruthy();
  });

  it('draw no running figure on a ride-only section', async () => {
    await render(
      <SectionPopup
        section={RIDE_SECTION}
        bottom={0}
        onClose={jest.fn()}
        onViewDetails={jest.fn()}
      />
    );
    expect(runGlyphs()).toHaveLength(0);
    expect(screen.getByTestId(`glyph-${ACTIVITY_COUNT_GLYPH}`)).toBeTruthy();
  });

  it('draw no running figure on a ride-only route', async () => {
    await render(
      <RoutePopup
        route={{
          routeId: 'ridge-loop',
          name: 'Ridge loop',
          activityCount: 5,
          distanceMeters: 8400,
        }}
        bottom={0}
        onClose={jest.fn()}
        onViewDetails={jest.fn()}
      />
    );
    expect(runGlyphs()).toHaveLength(0);
    expect(screen.getByTestId(`glyph-${ACTIVITY_COUNT_GLYPH}`)).toBeTruthy();
  });
});
