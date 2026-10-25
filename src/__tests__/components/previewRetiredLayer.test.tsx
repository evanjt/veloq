/**
 * Scenario: the detection preview map carries the retired layer beside the live catalogue.
 *
 * Expected behaviour: the retired sources and layers stay declared whether or not the layer is
 * drawn, so toggling it swaps data and never mounts a source; a tap on a retired or hidden line
 * selects it through the layer, and a tap on the preview's own line still selects a section.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import {
  buildPreviewLayers,
  PREVIEW_INTERACTIVE_LAYERS,
} from '@/features/routes/components/preview/previewMapLayerSpecs';
import { mapPalette } from '@/theme';
import type { PreviewSection } from '../../../modules/veloqrs/src/delegates/preview';

type Sources = Record<string, { data: GeoJSON.FeatureCollection }>;
const captured: { sources: Sources; onPress: (e: unknown) => void }[] = [];

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));

jest.mock('@/features/maps', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('@/features/maps'),
    MapSurface: (props: { sources: Sources; onPress: (e: unknown) => void }) => {
      captured.push({ sources: props.sources, onPress: props.onPress });
      return <View testID="map-surface" />;
    },
  };
});

jest.mock('@/features/settings/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ getGlobalMapStyle: () => 'light' }),
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const CENTRE = { binKey: '9:27', lat: 47.5, lng: 8.7 };

const LIVE: PreviewSection = {
  id: 'live',
  liveId: 'live',
  status: 'unchanged',
  name: 'Live',
  polyline: new ArrayBuffer(0),
  visits: 7,
  distanceM: 4200,
  elevationGainM: 88,
  avgGradePercent: 2.1,
  pinned: false,
};

const feature = (id: string): GeoJSON.Feature => ({
  type: 'Feature',
  properties: { id, role: 'idle', layer: 'retired', pairIds: '' },
  geometry: {
    type: 'LineString',
    coordinates: [
      [8.7, 47.5],
      [8.71, 47.51],
    ],
  },
});

const collection = (...ids: string[]): GeoJSON.FeatureCollection => ({
  type: 'FeatureCollection',
  features: ids.map(feature),
});

const LINES = {
  retired: collection('old'),
  current: collection('hidden'),
  selection: collection('old'),
  rows: [{ id: 'old', hasLine: true }],
};

async function renderMap(retiredLayer: Parameters<typeof PreviewMapView>[0]['retiredLayer']) {
  captured.length = 0;
  const onSelect = jest.fn();
  await render(
    <PreviewMapView
      result={null}
      currentSections={[LIVE]}
      centre={CENTRE}
      selectedId={null}
      showCurrent
      showProposed
      showRemoved
      onToggleCurrent={jest.fn()}
      onToggleProposed={jest.fn()}
      onToggleRemoved={jest.fn()}
      onSelect={onSelect}
      retiredLayer={retiredLayer}
    />
  );
  return { last: captured[captured.length - 1]!, onSelect };
}

const count = (sources: Sources, id: string) => sources[id]!.data.features.length;

describe('the retired layer on the preview map', () => {
  it('keeps every retired source declared and empty with no layer', async () => {
    const { last } = await renderMap(null);

    expect(count(last.sources, 'retired-sections')).toBe(0);
    expect(count(last.sources, 'retired-current-sections')).toBe(0);
    expect(count(last.sources, 'retired-selection')).toBe(0);
  });

  it('keeps them declared and empty while the layer is toggled off', async () => {
    const { last } = await renderMap({
      lines: LINES,
      show: false,
      onToggle: jest.fn(),
      onSelect: jest.fn(),
    });

    expect(count(last.sources, 'retired-sections')).toBe(0);
    expect(count(last.sources, 'retired-selection')).toBe(0);
  });

  it('draws the retired lines, the hidden current ones and the selection when shown', async () => {
    const { last } = await renderMap({
      lines: LINES,
      show: true,
      onToggle: jest.fn(),
      onSelect: jest.fn(),
    });

    expect(count(last.sources, 'retired-sections')).toBe(1);
    expect(count(last.sources, 'retired-current-sections')).toBe(1);
    expect(count(last.sources, 'retired-selection')).toBe(1);
  });

  it('selects a tapped retired line through the layer and not as a preview section', async () => {
    const onSelectRetired = jest.fn();
    const { last, onSelect } = await renderMap({
      lines: LINES,
      show: true,
      onToggle: jest.fn(),
      onSelect: onSelectRetired,
    });

    last.onPress({ feature: { properties: { id: 'old', layer: 'retired' } } });

    expect(onSelectRetired).toHaveBeenCalledWith('old');
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('still selects the preview’s own line as a section', async () => {
    const { last, onSelect } = await renderMap({
      lines: LINES,
      show: true,
      onToggle: jest.fn(),
      onSelect: jest.fn(),
    });

    last.onPress({ feature: { properties: { id: 'live', status: 'unchanged' } } });

    expect(onSelect).toHaveBeenCalledWith(LIVE);
  });

  it('toggles from its legend chip', async () => {
    const onToggle = jest.fn();
    captured.length = 0;
    const tree = await render(
      <PreviewMapView
        result={null}
        currentSections={[LIVE]}
        centre={CENTRE}
        selectedId={null}
        showCurrent
        showProposed
        showRemoved
        onToggleCurrent={jest.fn()}
        onToggleProposed={jest.fn()}
        onToggleRemoved={jest.fn()}
        onSelect={jest.fn()}
        retiredLayer={{ lines: LINES, show: true, onToggle, onSelect: jest.fn() }}
      />
    );

    await fireEvent.press(tree.getByTestId('preview-layer-retired'));

    expect(onToggle).toHaveBeenCalledTimes(1);
    expect(tree.getByTestId('preview-layer-retired').props.accessibilityState).toMatchObject({
      checked: true,
    });
  });

  it('declares a layer for every retired source and takes taps on the lines a person sees', () => {
    const layers = buildPreviewLayers(mapPalette('light'));
    const sourcesDrawn = new Set(layers.map((l) => l.source));

    for (const source of ['retired-sections', 'retired-current-sections', 'retired-selection']) {
      expect(sourcesDrawn.has(source)).toBe(true);
    }
    expect(PREVIEW_INTERACTIVE_LAYERS).toEqual(
      expect.arrayContaining(['retired-line', 'retired-hidden-line'])
    );
    // The highlight must not take a tap meant for the line under it.
    expect(PREVIEW_INTERACTIVE_LAYERS).not.toContain('retired-selection-line');
    expect(PREVIEW_INTERACTIVE_LAYERS).not.toContain('retired-selection-casing');
  });
});
