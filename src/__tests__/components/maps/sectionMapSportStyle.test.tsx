/**
 * Scenario: the sport a section is read in decides which basemap style the
 * athlete's own map preferences hand back, and which colour the line is drawn
 * in. That is the sport the screen picked, or the section's only sport; ground
 * several sports have taken has none until one is picked.
 *
 * Expected behaviour: the sport is read against the one activity vocabulary
 * the app keeps. A hand-written set of nineteen strings beside it had no
 * gravel, mountain bike, e-bike, treadmill, handcycle, velomobile, track or
 * cyclocross, and every one of them fell through to `Ride`, so a gravel
 * section opened on the style the athlete chose for road.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';

import { SectionMapView } from '@/features/routes/components/SectionMapView';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

const askedFor: string[] = [];

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: (activityType: string) => {
      askedFor.push(activityType);
      return 'light';
    },
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

jest.mock('expo-location', () => ({
  ...jest.requireActual('expo-location'),
  requestForegroundPermissionsAsync: jest.fn().mockResolvedValue({ status: 'denied' }),
  getCurrentPositionAsync: jest.fn(),
  Accuracy: { Balanced: 3 },
}));

const METRICS = {
  frame: { x: 0, y: 0, width: 390, height: 844 },
  insets: { top: 47, left: 0, right: 0, bottom: 34 },
};

const POLYLINE: RoutePoint[] = [
  { lat: 46.948, lng: 7.447 },
  { lat: 46.949, lng: 7.448 },
  { lat: 46.95, lng: 7.449 },
];

function sectionOfSports(sportTypes: string[]): FrequentSection {
  return {
    id: 'section-1',
    sectionType: 'auto',
    name: 'A climb',
    sportTypes,
    polyline: POLYLINE,
    activityIds: ['a1'],
    visitCount: 3,
    distanceMeters: 900,
    createdAt: '2026-01-01T00:00:00Z',
  };
}

/** Which sport the map asked the athlete's preferences about, if any. */
function styleAskedFor(sportTypes: string[], picked?: string): string | undefined {
  askedFor.length = 0;
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionMapView section={sectionOfSports(sportTypes)} sportType={picked} />
    </SafeAreaProvider>
  );
  return askedFor[0];
}

describe('the sport a section map draws', () => {
  it.each([
    'GravelRide',
    'MountainBikeRide',
    'EBikeRide',
    'Handcycle',
    'Velomobile',
    'Treadmill',
    'TrackRide',
    'Cyclocross',
  ])('is the section its own, not road cycling: %s', (sportType) => {
    expect(styleAskedFor([sportType])).toBe(sportType);
  });

  it('is unchanged for the sports that always worked', () => {
    expect(styleAskedFor(['Ride'])).toBe('Ride');
    expect(styleAskedFor(['Hike'])).toBe('Hike');
    expect(styleAskedFor(['OpenWaterSwim'])).toBe('OpenWaterSwim');
  });

  it('falls through to Other for a sport the app does not know', () => {
    expect(styleAskedFor(['Quidditch'])).toBe('Other');
  });

  it('is the picked sport on ground ridden and run', () => {
    expect(styleAskedFor(['Ride', 'Run'], 'Run')).toBe('Run');
  });

  it('is none on ground ridden and run with nothing picked, so the default style holds', () => {
    expect(styleAskedFor(['Ride', 'Run'])).toBeUndefined();
  });
});
