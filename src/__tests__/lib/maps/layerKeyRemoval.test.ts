/**
 * Scenario: a route's line is coloured by a gradient while an attempt is
 * selected, and the athlete clears the selection. The next layer spec for the
 * same id carries `line-color` and no `line-gradient`. Separately, a symbol
 * layer loses its `icon-rotate`, and a line loses the `minzoom` it was
 * narrowed to.
 *
 * Expected behaviour: each key the new spec drops is cleared on the existing
 * layer, so MapLibre draws the colour the new spec asks for and not the old
 * gradient. A layout key is cleared with undefined, a paint key with null, and
 * a dropped minzoom or filter returns the layer to its full range.
 */
import vm from 'vm';

import { surfaceRuntimeScript } from '@/features/maps/lib/htmlBuilders/mapSurfaceScripts';
import type {
  MapLayerSpec,
  MapSurfaceHtmlConfig,
} from '@/features/maps/lib/htmlBuilders/mapSurface';

const config: MapSurfaceHtmlConfig = {
  style: 'light',
  camera: { center: [7.448, 46.949], zoom: 12 },
  interaction: { scroll: true, zoom: true, rotate: true, pitch: false },
  devicePixelRatio: 2,
  reduceMotion: false,
  regionChangeThrottleMs: 100,
};

const GRADIENT = ['interpolate', ['linear'], ['line-progress'], 0, '#ffffff', 1, '#000000'];

const banded: MapLayerSpec = {
  id: 'route-line',
  type: 'line',
  source: 'route',
  layout: { 'line-cap': 'round' },
  paint: { 'line-gradient': GRADIENT, 'line-width': 4 },
  minzoom: 10,
  filter: ['==', ['get', 'band'], 1],
};

const plain: MapLayerSpec = {
  id: 'route-line',
  type: 'line',
  source: 'route',
  layout: { 'line-cap': 'round' },
  paint: { 'line-color': '#ff0000', 'line-width': 4 },
};

function runPage() {
  const present = new Set<string>();
  const map = {
    getLayer: (id: string) => (present.has(id) ? { id } : undefined),
    addLayer: jest.fn((definition: { id: string }) => {
      present.add(definition.id);
    }),
    removeLayer: jest.fn(),
    setPaintProperty: jest.fn(),
    setLayoutProperty: jest.fn(),
    setFilter: jest.fn(),
    setLayerZoomRange: jest.fn(),
    getSource: () => undefined,
    hasImage: () => true,
  };
  const window: Record<string, unknown> = { map, _rn_log: jest.fn() };
  const context = vm.createContext({ window, setTimeout, clearTimeout, console });
  vm.runInContext(surfaceRuntimeScript(config), context);
  const veloq = window._veloq as {
    ready: boolean;
    apply: (patch: unknown) => void;
  };
  veloq.ready = true;
  const show = (layers: MapLayerSpec[]) => veloq.apply({ images: [], layers });
  return { map, show };
}

describe('a layer spec that drops a key clears it on the existing layer', () => {
  it('clears the paint key the next spec drops and sets the one it adds', () => {
    const { map, show } = runPage();
    show([banded]);
    map.setPaintProperty.mockClear();

    show([plain]);

    expect(map.setPaintProperty).toHaveBeenCalledWith('route-line', 'line-gradient', null);
    expect(map.setPaintProperty).toHaveBeenCalledWith('route-line', 'line-color', '#ff0000');
    expect(map.setPaintProperty).not.toHaveBeenCalledWith(
      'route-line',
      'line-width',
      expect.anything()
    );
  });

  it('restores the gradient when the selection returns', () => {
    const { map, show } = runPage();
    show([plain]);
    show([banded]);
    map.setPaintProperty.mockClear();

    show([plain]);
    show([banded]);

    expect(map.setPaintProperty).toHaveBeenCalledWith('route-line', 'line-gradient', GRADIENT);
    expect(map.setPaintProperty).toHaveBeenCalledWith('route-line', 'line-color', null);
  });

  it('clears a layout key the next spec drops with undefined', () => {
    const { map, show } = runPage();
    const rotated: MapLayerSpec = {
      id: 'pins',
      type: 'symbol',
      source: 'route',
      layout: { 'icon-rotate': 30, 'icon-image': 'pin' },
    };
    const upright: MapLayerSpec = {
      id: 'pins',
      type: 'symbol',
      source: 'route',
      layout: { 'icon-image': 'pin' },
    };
    show([rotated]);
    map.setLayoutProperty.mockClear();

    show([upright]);

    expect(map.setLayoutProperty).toHaveBeenCalledWith('pins', 'icon-rotate', undefined);
    expect(map.setLayoutProperty).not.toHaveBeenCalledWith('pins', 'icon-image', expect.anything());
  });

  it('returns the layer to its full zoom range when the next spec drops minzoom', () => {
    const { map, show } = runPage();
    show([banded]);
    map.setLayerZoomRange.mockClear();

    show([plain]);

    expect(map.setLayerZoomRange).toHaveBeenCalledWith('route-line', 0, 24);
  });

  it('applies a minzoom the next spec adds', () => {
    const { map, show } = runPage();
    show([plain]);
    map.setLayerZoomRange.mockClear();

    show([banded]);

    expect(map.setLayerZoomRange).toHaveBeenCalledWith('route-line', 10, 24);
  });

  it('clears the filter the next spec drops', () => {
    const { map, show } = runPage();
    show([banded]);
    map.setFilter.mockClear();

    show([plain]);

    expect(map.setFilter).toHaveBeenCalledWith('route-line', null);
  });

  vaultIt('touches nothing when the second call repeats the same spec', () => {
    const { map, show } = runPage();
    show([banded]);
    show([banded]);
    map.setPaintProperty.mockClear();
    map.setLayoutProperty.mockClear();
    map.setLayerZoomRange.mockClear();
    map.setFilter.mockClear();

    show([banded]);

    expect(map.setPaintProperty).not.toHaveBeenCalled();
    expect(map.setLayoutProperty).not.toHaveBeenCalled();
    expect(map.setLayerZoomRange).not.toHaveBeenCalled();
    expect(map.setFilter).not.toHaveBeenCalled();
  });
});
