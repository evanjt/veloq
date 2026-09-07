/**
 * Scenario: the two chips at the top right of the detection preview map.
 * Expected behaviour: they are the map's only key, so each carries the colour
 * of the layer it toggles, taken from that layer's own spec rather than a
 * second copy of the value. Both on, they are distinguishable; off, they are
 * visibly off and report themselves as switches.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { PreviewMapView } from '@/features/routes/components/preview/PreviewMapView';
import { buildPreviewLayers } from '@/features/routes/components/preview/previewMapLayerSpecs';

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { longitude: 8.7, latitude: 47.5 },
      { longitude: 8.71, latitude: 47.51 },
    ],
  })
);

jest.mock('@/features/maps/components', () => {
  const { View } = require('react-native');
  return {
    ...require('@/features/maps/components/AttributionOverlay'),
    MapSurface: () => <View testID="map-surface" />,
  };
});

jest.mock('@/features/maps/stores/MapPreferencesContext', () => ({
  useMapPreferences: () => ({ getGlobalMapStyle: () => 'light' }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const CENTRE = { binKey: '9:27', lat: 47.5, lng: 8.7 };

function lineColour(layerId: string): string {
  const paint = buildPreviewLayers().find((l) => l.id === layerId)?.paint;
  const colour = paint?.['line-color'];
  return Array.isArray(colour) ? (colour[colour.length - 1] as string) : (colour as string);
}

function renderMap(
  over: { showCurrent?: boolean; showProposed?: boolean; showRemoved?: boolean } = {}
) {
  return render(
    <PreviewMapView
      result={null}
      currentSections={[]}
      centre={CENTRE}
      selectedId={null}
      showCurrent={over.showCurrent ?? true}
      showProposed={over.showProposed ?? true}
      showRemoved={over.showRemoved ?? true}
      onToggleCurrent={jest.fn()}
      onToggleProposed={jest.fn()}
      onToggleRemoved={jest.fn()}
      onSelect={jest.fn()}
    />
  );
}

function flatStyle(node: { props: Record<string, unknown> }): Record<string, unknown> {
  const style = node.props.style;
  const parts = Array.isArray(style) ? style.flat(Infinity) : [style];
  return Object.assign({}, ...parts.filter(Boolean));
}

describe('preview map legend chips', () => {
  it('gives each chip the colour of the layer it toggles', () => {
    const tree = renderMap();

    expect(flatStyle(tree.getByTestId('preview-layer-current-swatch')).backgroundColor).toBe(
      lineColour('current-line')
    );
    expect(flatStyle(tree.getByTestId('preview-layer-proposed-swatch')).backgroundColor).toBe(
      lineColour('proposed-line')
    );
  });

  it('gives the removed catalogue its own chip in the error colour', () => {
    const tree = renderMap();

    expect(flatStyle(tree.getByTestId('preview-layer-removed-swatch')).backgroundColor).toBe(
      lineColour('gone-line')
    );
  });

  it('does not paint both chips the same colour when both are on', () => {
    const tree = renderMap();

    const current = flatStyle(tree.getByTestId('preview-layer-current-swatch')).backgroundColor;
    const proposed = flatStyle(tree.getByTestId('preview-layer-proposed-swatch')).backgroundColor;

    expect(current).not.toBe(proposed);
  });

  it('shows an off chip as off rather than as a slightly different grey', () => {
    const on = flatStyle(renderMap().getByTestId('preview-layer-current-swatch'));
    const off = flatStyle(
      renderMap({ showCurrent: false }).getByTestId('preview-layer-current-swatch')
    );

    expect(off.backgroundColor).not.toBe(on.backgroundColor);
    expect(off.backgroundColor).toBe('transparent');
  });

  it('reports each chip as a switch carrying its own state', () => {
    const tree = renderMap({ showProposed: false });

    const current = tree.getByTestId('preview-layer-current');
    const proposed = tree.getByTestId('preview-layer-proposed');

    expect(current.props.accessibilityRole).toBe('switch');
    expect(current.props.accessibilityState).toEqual({ checked: true });
    expect(proposed.props.accessibilityState).toEqual({ checked: false });
  });
});
