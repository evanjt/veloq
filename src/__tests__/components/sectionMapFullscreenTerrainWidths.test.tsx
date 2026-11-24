/**
 * Scenario: the athlete opens a section's fullscreen map while the section map is
 * tilted over terrain, and the fullscreen overlays are drawn by the layer builder
 * the fullscreen base calls with its own terrain flag.
 *
 * Expected behaviour: on a tilted base the overlay lines are drawn at
 * `MAP_3D_SCALE` of their flat widths, as the inline map draws them. On a flat base
 * they keep their flat widths.
 */

import React from 'react';
import { render, fireEvent, screen } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { BaseMapView } from '@/features/maps/components/BaseMapView';
import type { MapLayersForBase } from '@/features/maps/lib/baseMapLayers';
import { MAP_3D_SCALE } from '@/features/maps/lib/mapLineWidths';
import type { MapLayerSpec } from '@/features/maps/lib/htmlBuilders';
import { SectionMapView } from '@/features/routes/components/SectionMapView';
import type { FrequentSection, RoutePoint } from '@/types';
import { mapPalette } from '@/theme';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({
    preferences: { defaultStyle: 'light' },
    getStyleForActivity: () => 'light',
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
  { lat: 46.951, lng: 7.45 },
  { lat: 46.952, lng: 7.451 },
];

const palette = mapPalette('light');

function section(): FrequentSection {
  return {
    id: 'section-1',
    sectionType: 'auto',
    name: 'Bern climb',
    sportTypes: ['Ride'],
    polyline: POLYLINE,
    distanceMeters: 1200,
    activityIds: ['a1', 'a2', 'a3'],
    visitCount: 7,
    createdAt: '2026-01-15T10:00:00Z',
  };
}

function lineWidth(layers: MapLayerSpec[], id: string): number {
  const width = (layers.find((layer) => layer.id === id)?.paint as Record<string, unknown>)?.[
    'line-width'
  ];
  if (typeof width !== 'number') throw new Error(`no numeric line-width on ${id}`);
  return width;
}

/** The fullscreen base is the one rendered with overlay layers; the inline map passes none. */
function fullscreenOverlayLayers(): MapLayersForBase {
  const base = screen.UNSAFE_getAllByType(BaseMapView).find((el) => el.props.overlayLayers);
  if (!base) throw new Error('no fullscreen base rendered');
  return base.props.overlayLayers as MapLayersForBase;
}

async function openFullscreenSection() {
  render(
    <SafeAreaProvider initialMetrics={METRICS}>
      <SectionMapView
        section={section()}
        interactive
        enableFullscreen
        highlightedActivityId={null}
      />
    </SafeAreaProvider>
  );
  await fireEvent.press(screen.getByTestId('section-map-fullscreen'));
  return fullscreenOverlayLayers();
}

describe('section fullscreen overlays over terrain', () => {
  it.each(['all-traces-line', 'highlighted-lap-line'])(
    'draws %s at the 3D width on a tilted base',
    async (id) => {
      const overlayLayers = await openFullscreenSection();

      const flat = overlayLayers(palette, false);
      const tilted = overlayLayers(palette, true);

      expect(lineWidth(tilted, id)).toBeCloseTo(lineWidth(flat, id) * MAP_3D_SCALE);
    }
  );

  it('keeps the flat width on a flat base', async () => {
    const overlayLayers = await openFullscreenSection();

    expect(lineWidth(overlayLayers(palette, false), 'all-traces-line')).toBe(5);
  });
});
