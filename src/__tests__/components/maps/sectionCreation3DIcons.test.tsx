/**
 * Scenario: the 3D pages labelled the section creation start and end markers
 * with U+25B6 and U+25A0, which sit in a glyph range the app does not bundle,
 * so offline the markers fell back to the device font and online each map open
 * fetched a glyph range for two shapes.
 *
 * Expected behaviour: both the page and the re-add after a style switch draw the
 * markers from the bundled SDF icons, registered on the map before use, tinted
 * the colour the glyphs had.
 */
import React from 'react';
import { View } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import { MAPLIBRE_GL_JS } from '@/features/maps/assets/maplibreRenderer.generated';
import { buildMap3DHtml } from '@/features/maps/lib/htmlBuilders';
import { addSectionCreation3DLayersScript } from '@/features/maps/lib/sectionCreationPaint';
import { SECTION_END_ICON_ID, SECTION_START_ICON_ID } from '@/features/maps/lib/mapIcons';
import { colors, mapLayerColors } from '@/theme';

const injected: string[] = [];
let onMessage: ((event: { nativeEvent: { data: string } }) => void) | null = null;

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { onMessage: (event: { nativeEvent: { data: string } }) => void },
  ref: React.Ref<{ injectJavaScript: (script: string) => void; reload: () => void }>
) {
  onMessage = props.onMessage;
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: (script: string) => injected.push(script),
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

interface FakeLayer {
  id: string;
  type: string;
  layout?: Record<string, unknown>;
  paint?: Record<string, unknown>;
}

function fakeMap() {
  const images = new Map<string, { sdf: boolean }>();
  const layers: FakeLayer[] = [];
  return {
    images,
    layers,
    hasImage: (id: string) => images.has(id),
    addImage: (id: string, _image: unknown, options: { sdf?: boolean }) => {
      if (images.has(id)) throw new Error(`image ${id} already exists`);
      images.set(id, { sdf: !!options?.sdf });
    },
    addLayer: (layer: FakeLayer) => layers.push(layer),
    getSource: (): undefined => undefined,
    addSource: () => {},
    setLayoutProperty: () => {},
  };
}

class LoadingImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  set src(_value: string) {
    queueMicrotask(() => this.onload?.());
  }
}

async function run(script: string, map: ReturnType<typeof fakeMap>) {
  new Function('window', 'Image', 'console', script)({ map }, LoadingImage, console);
  await Promise.resolve();
  await Promise.resolve();
}

const BUNDLE_MISSING_GLYPHS = /[▶■]|\\u25B6|\\u25A0/i;

describe('3D section creation markers', () => {
  it('register both icons as signed distance fields and label the markers with them', async () => {
    const map = fakeMap();
    await run(
      addSectionCreation3DLayersScript('window.map', 'section-creation-markers', true),
      map
    );

    expect(map.images.get(SECTION_START_ICON_ID)).toEqual({ sdf: true });
    expect(map.images.get(SECTION_END_ICON_ID)).toEqual({ sdf: true });
    const icon = map.layers.find((l) => l.type === 'symbol');
    expect(icon?.layout).not.toHaveProperty('text-field');
    expect(icon?.layout?.['icon-image']).toEqual([
      'case',
      ['==', ['get', 'type'], 'start'],
      SECTION_START_ICON_ID,
      SECTION_END_ICON_ID,
    ]);
    expect(icon?.paint?.['icon-color']).toBe(mapLayerColors.casing);
    expect(map.layers.map((l) => l.type)).toEqual(['circle', 'symbol']);
  });

  it('register each icon once when the layers are added a second time', async () => {
    const map = fakeMap();
    await run(
      addSectionCreation3DLayersScript('window.map', 'section-creation-markers', true),
      map
    );
    await run(
      addSectionCreation3DLayersScript('window.map', 'section-creation-markers', true),
      map
    );

    expect(map.images.size).toBe(2);
  });

  it('add only the line for the line source', async () => {
    const map = fakeMap();
    await run(addSectionCreation3DLayersScript('window.map', 'section-creation-line', false), map);

    expect(map.layers.map((l) => l.type)).toEqual(['line']);
    expect(map.layers[0]!.layout?.visibility).toBe('none');
  });

  it('are re-added from the icons after a style switch wiped them', async () => {
    jest.useFakeTimers();
    const creating = (mapStyle: 'light' | 'dark') => (
      <Map3DWebView
        coordinates={[
          [7.4, 46.9],
          [7.5, 46.95],
        ]}
        mapStyle={mapStyle}
        sectionCreationStart={[7.4, 46.9]}
        sectionCreationEnd={[7.5, 46.95]}
      />
    );
    const view = render(creating('light'));
    act(() => onMessage?.({ nativeEvent: { data: JSON.stringify({ type: 'mapReady' }) } }));
    view.rerender(creating('dark'));
    injected.length = 0;
    act(() => {
      jest.advanceTimersByTime(600);
    });
    jest.useRealTimers();
    const readd = injected.find((s) => s.includes("addSource('section-creation-markers'"));
    expect(readd).toBeDefined();
    expect(readd).not.toMatch(BUNDLE_MISSING_GLYPHS);

    const map = fakeMap();
    await run(readd!, map);

    expect([...map.images.keys()].sort()).toEqual([SECTION_END_ICON_ID, SECTION_START_ICON_ID]);
    const icon = map.layers.find((l) => l.type === 'symbol');
    expect(icon?.layout).not.toHaveProperty('text-field');
    expect(icon?.layout?.visibility).toBeUndefined();
    view.unmount();
  });

  it('leave no glyph outside the bundled ranges in the page', () => {
    const html = buildMap3DHtml({
      coordinates: [],
      bounds: null,
      centerOverride: null,
      zoom: 1,
      bearing: 0,
      pitch: 0,
      hasSavedCamera: false,
      terrainExaggeration: 1,
      initStyle: 'light',
      mapStyle: 'light',
      routeColor: colors.success,
      showHeatmap: false,
      devicePixelRatio: 1,
    });

    expect(html.replace(MAPLIBRE_GL_JS, '')).not.toMatch(BUNDLE_MISSING_GLYPHS);
    expect(html).toContain(
      addSectionCreation3DLayersScript('map', 'section-creation-markers', false)
    );
  });
});
