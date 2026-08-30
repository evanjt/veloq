/**
 * Scenario: the section detail hero map is rendered for sections whose
 * polyline, traces and trim range vary in quality.
 *
 * Expected behaviour: the interactive form exposes `section-map-container` and
 * its control testIDs, fullscreen opens and closes, and a section with no
 * usable geometry still mounts.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
  }),
}));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));

jest.mock('expo-location', () => ({
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
  { lat: 46.951, lng: 7.45 },
  { lat: 46.952, lng: 7.451 },
];

function section(overrides: Partial<FrequentSection> = {}): FrequentSection {
  return {
    id: 'section-1',
    sectionType: 'auto',
    name: 'Bern climb',
    sportType: 'Ride',
    polyline: POLYLINE,
    distanceMeters: 1200,
    activityIds: ['a1', 'a2'],
    visitCount: 7,
    createdAt: '2026-01-15T10:00:00Z',
    ...overrides,
  };
}

function renderSection(props: Partial<React.ComponentProps<typeof SectionMapView>> = {}) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionMapView section={section()} interactive {...props} />
    </SafeAreaProvider>
  );
}

describe('SectionMapView', () => {
  it('mounts the interactive container with a map', () => {
    renderSection();

    expect(screen.getByTestId('section-map-container')).toBeTruthy();
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
    expect(screen.getByTestId('section-map-style-toggle')).toBeTruthy();
    expect(screen.getByTestId('section-map-3d-toggle')).toBeTruthy();
  });

  it('drops the control stack in preview mode', () => {
    renderSection({ interactive: false });

    expect(screen.queryByTestId('section-map-container')).toBeNull();
    expect(screen.queryByTestId('section-map-style-toggle')).toBeNull();
    expect(screen.getByTestId('maplibre-map')).toBeTruthy();
  });

  it('opens and closes fullscreen from the control stack', () => {
    renderSection({ enableFullscreen: true });

    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();

    fireEvent(screen.getByTestId('section-map-fullscreen'), 'pressIn');
    expect(screen.getByTestId('map-fullscreen-close')).toBeTruthy();

    fireEvent.press(screen.getByTestId('map-fullscreen-close'));
    expect(screen.queryByTestId('map-fullscreen-close')).toBeNull();
  });

  it('hides the fullscreen control while trimming', () => {
    renderSection({ enableFullscreen: true, trimRange: { start: 1, end: 3 } });

    expect(screen.queryByTestId('section-map-fullscreen')).toBeNull();
    expect(screen.getByTestId('section-map-container')).toBeTruthy();
  });

  it('swaps in the terrain view when 3D is enabled', () => {
    renderSection();

    expect(screen.queryByTestId('webview')).toBeNull();

    fireEvent(screen.getByTestId('section-map-3d-toggle'), 'pressIn');
    expect(screen.getByTestId('webview')).toBeTruthy();

    fireEvent(screen.getByTestId('section-map-3d-toggle'), 'pressIn');
    expect(screen.queryByTestId('webview')).toBeNull();
  });

  it('keeps the style toggle pressable', () => {
    renderSection();

    const toggle = screen.getByTestId('section-map-style-toggle');
    expect(() => {
      fireEvent(toggle, 'pressIn');
      fireEvent(toggle, 'pressIn');
      fireEvent(toggle, 'pressIn');
    }).not.toThrow();
    expect(screen.getByTestId('section-map-container')).toBeTruthy();
  });

  it('renders pre-loaded traces while scrubbing', () => {
    renderSection({
      allActivityTraces: { a1: POLYLINE, a2: POLYLINE.slice(0, 3) },
      highlightedActivityId: 'a1',
      isScrubbing: true,
    });

    expect(screen.getByTestId('section-map-container')).toBeTruthy();
  });

  describe('degenerate input', () => {
    it('falls back to a placeholder for an empty polyline', () => {
      renderSection({ section: section({ polyline: [] }) });

      expect(screen.queryByTestId('section-map-container')).toBeNull();
      expect(screen.queryByTestId('maplibre-map')).toBeNull();
    });

    const cases: [string, Partial<React.ComponentProps<typeof SectionMapView>>][] = [
      ['a single-point polyline', { section: section({ polyline: [POLYLINE[0]] }) }],
      [
        'non-finite polyline points',
        {
          section: section({
            polyline: [{ lat: NaN, lng: 7.447 }, { lat: 46.949, lng: Infinity }, ...POLYLINE],
          }),
        },
      ],
      ['an unknown sport type', { section: section({ sportType: 'Paragliding' }) }],
      ['a trim range beyond the polyline', { trimRange: { start: 0, end: 99 } }],
      ['an inverted trim range', { trimRange: { start: 4, end: 1 } }],
      ['an empty extension track', { extensionTrack: [] }],
      ['empty activity traces', { allActivityTraces: {}, highlightedActivityId: 'a1' }],
      ['a highlighted activity with no trace', { highlightedActivityId: 'missing' }],
      ['an empty shadow track', { shadowTrack: [] }],
      ['no nearby polylines', { nearbyPolylines: [] }],
    ];

    it.each(cases)('survives %s', (_label, props) => {
      expect(() => renderSection(props)).not.toThrow();
      expect(screen.getByTestId('section-map-container')).toBeTruthy();
    });
  });
  it('falls back to the 2D map when the terrain page reports failure', () => {
    renderSection();

    fireEvent(screen.getByTestId('section-map-3d-toggle'), 'pressIn');
    expect(screen.getByTestId('section-map-3d-loading')).toBeTruthy();

    fireEvent(screen.getByTestId('webview'), 'message', {
      nativeEvent: { data: JSON.stringify({ type: 'mapFailed', reason: 'ready timeout' }) },
    });

    expect(screen.queryByTestId('section-map-3d-loading')).toBeNull();
    expect(screen.queryByTestId('webview')).toBeNull();
    expect(screen.getByTestId('section-map-container')).toBeTruthy();
  });
});
