/**
 * Scenario: the athlete scrubs the section detail chart with the fullscreen
 * modal shut, so every new index sends a fresh `highlightedActivityId` through
 * `SectionMapView`.
 *
 * Expected behaviour: the fullscreen source and layer specs are built only
 * while the modal is open. A scrub with it shut rebuilds the inline pair and
 * nothing else, and opening builds the fullscreen pair with the highlight the
 * scrub left in place.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import type { FrequentSection, RoutePoint } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

const mockBuildSources = jest.fn();
const mockBuildLayers = jest.fn();
jest.mock('@/features/routes/components/sectionMapLayerSpecs', () => {
  const actual = jest.requireActual('@/features/routes/components/sectionMapLayerSpecs');
  return {
    ...actual,
    buildSectionSources: (args: Record<string, unknown>) => {
      mockBuildSources(args);
      return actual.buildSectionSources(args);
    },
    buildSectionLayers: (args: Record<string, unknown>) => {
      mockBuildLayers(args);
      return actual.buildSectionLayers(args);
    },
  };
});

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

function section(): FrequentSection {
  return {
    id: 'section-1',
    sectionType: 'auto',
    name: 'Bern climb',
    sportType: 'Ride',
    polyline: POLYLINE,
    distanceMeters: 1200,
    activityIds: ['a1', 'a2', 'a3'],
    visitCount: 7,
    createdAt: '2026-01-15T10:00:00Z',
  };
}

/** The fullscreen pair is the only one built with the section line suppressed. */
function fullscreenCalls(spy: jest.Mock): Record<string, unknown>[] {
  return spy.mock.calls
    .map(([args]) => args as Record<string, unknown>)
    .filter((args) => args.showExtensionAndSection === false);
}

function renderSection(highlightedActivityId: string | null) {
  return render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionMapView
        section={section()}
        interactive
        enableFullscreen
        highlightedActivityId={highlightedActivityId}
      />
    </SafeAreaProvider>
  );
}

describe('SectionMapView fullscreen specs while the modal is shut', () => {
  beforeEach(() => {
    mockBuildSources.mockClear();
    mockBuildLayers.mockClear();
  });

  it('builds no fullscreen spec on mount', () => {
    renderSection(null);

    expect(fullscreenCalls(mockBuildSources)).toHaveLength(0);
    expect(fullscreenCalls(mockBuildLayers)).toHaveLength(0);
  });

  it('builds no fullscreen spec across a scrub', () => {
    const { rerender } = renderSection(null);

    for (const id of ['a1', 'a2', 'a3']) {
      rerender(
        <SafeAreaProvider initialMetrics={METRICS}>
          <SectionMapView
            section={section()}
            interactive
            enableFullscreen
            highlightedActivityId={id}
          />
        </SafeAreaProvider>
      );
    }

    expect(fullscreenCalls(mockBuildSources)).toHaveLength(0);
    expect(fullscreenCalls(mockBuildLayers)).toHaveLength(0);
  });

  it('builds the fullscreen pair on open, carrying the highlight the scrub left', () => {
    renderSection('a2');
    expect(fullscreenCalls(mockBuildSources)).toHaveLength(0);

    fireEvent(screen.getByTestId('section-map-fullscreen'), 'pressIn');

    const sources = fullscreenCalls(mockBuildSources);
    const layers = fullscreenCalls(mockBuildLayers);
    expect(sources.length).toBeGreaterThan(0);
    expect(layers.length).toBeGreaterThan(0);
    expect(sources[sources.length - 1].sectionOpacity).toBe(0.4);
  });

  it('stops building fullscreen specs again once it is closed', () => {
    renderSection('a1');
    fireEvent(screen.getByTestId('section-map-fullscreen'), 'pressIn');
    fireEvent.press(screen.getByTestId('map-fullscreen-close'));

    mockBuildSources.mockClear();
    mockBuildLayers.mockClear();

    const { rerender } = renderSection('a3');
    rerender(
      <SafeAreaProvider initialMetrics={METRICS}>
        <SectionMapView
          section={section()}
          interactive
          enableFullscreen
          highlightedActivityId="a2"
        />
      </SafeAreaProvider>
    );

    expect(fullscreenCalls(mockBuildSources)).toHaveLength(0);
    expect(fullscreenCalls(mockBuildLayers)).toHaveLength(0);
  });
});
