/**
 * Scenario: on Android a map WebView is a keyboard focus stop, and so is the
 * page's own canvas inside it. Neither draws a focus indication and neither
 * answers a key, since the map page turns its keyboard handling off, so a
 * keyboard user meets two invisible stops that do nothing. A screen reader
 * meets the same two, unnamed, and on the Feed they belong to the hidden
 * snapshot pool behind it.
 *
 * Expected behaviour: every map WebView sits inside a `KeyboardFocusBlock`,
 * which takes it and everything in it out of keyboard focus while touch still
 * reaches the page, and is hidden from screen readers. A map given a label is
 * one image element carrying it; a map given none exposes nothing. The map's
 * actions are its native controls, which sit outside the WebView.
 */

import React from 'react';
import { isHiddenFromAccessibility, render, screen } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';
import { WebView } from 'react-native-webview';

import { MapSurface, type MapSurfaceProps } from '@/features/maps/components/MapSurface';
import { Map3DWebView } from '@/features/maps/components/Map3DWebView';
import { TerrainSnapshotWebView } from '@/features/maps/components/TerrainSnapshotWebView';
import { KeyboardFocusBlock } from '@/shared/ui/KeyboardFocusBlock';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: true, colors: require('@/theme').darkColors }),
}));

const EMPTY: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Every WebView rendered, each with whether a `KeyboardFocusBlock` holds it. */
function webViewsBlocked(): boolean[] {
  return screen.UNSAFE_getAllByType(WebView).map((webView) => {
    for (let node = webView.parent; node; node = node.parent) {
      if (node.type === KeyboardFocusBlock) return true;
    }
    return false;
  });
}

/** Every WebView rendered, each with whether an ancestor hides it from screen readers. */
function webViewsHidden(): boolean[] {
  return screen.UNSAFE_getAllByType(WebView).map((webView) => {
    for (let node = webView.parent; node; node = node.parent) {
      if (
        node.props.importantForAccessibility === 'no-hide-descendants' &&
        node.props.accessibilityElementsHidden === true
      ) {
        return true;
      }
    }
    return false;
  });
}

/** Host elements a screen reader can stop on: accessible, named or given a role, and not hidden. */
function accessibleElements(): ReactTestInstance[] {
  return screen.root
    .findAll((node) => typeof node.type === 'string')
    .filter(
      (node) =>
        (node.props.accessible === true ||
          node.props.accessibilityLabel != null ||
          node.props.accessibilityRole != null ||
          node.props.role != null) &&
        !isHiddenFromAccessibility(node)
    );
}

const SURFACE_PROPS: MapSurfaceProps = {
  mapStyle: 'light',
  initialCamera: { center: [7.448, 46.949], zoom: 12 },
  sources: {},
  layers: [],
};

describe('map WebViews are hidden from screen readers', () => {
  it('hides the 2D map surface and exposes nothing without a label', async () => {
    await render(<MapSurface {...SURFACE_PROPS} />);

    expect(webViewsHidden()).toEqual([true]);
    expect(accessibleElements()).toEqual([]);
  });

  it('exposes a labelled 2D map surface as one image', async () => {
    await render(
      <MapSurface {...SURFACE_PROPS} accessibilityLabel="12 activities · 9 on the map" />
    );

    expect(webViewsHidden()).toEqual([true]);
    const exposed = accessibleElements();
    expect(exposed).toHaveLength(1);
    expect(exposed[0]!.props.accessibilityRole).toBe('image');
    expect(exposed[0]!.props.accessibilityLabel).toBe('12 activities · 9 on the map');
  });

  it('hides the 3D map and exposes nothing without a label', async () => {
    await render(
      <Map3DWebView coordinates={[[7.4, 46.9]]} mapStyle="light" routesGeoJSON={EMPTY} />
    );

    expect(webViewsHidden()).toEqual([true]);
    expect(accessibleElements()).toEqual([]);
  });

  it('exposes a labelled 3D map as one image', async () => {
    await render(
      <Map3DWebView
        coordinates={[[7.4, 46.9]]}
        mapStyle="light"
        routesGeoJSON={EMPTY}
        accessibilityLabel="Hill loop"
      />
    );

    expect(webViewsHidden()).toEqual([true]);
    expect(screen.getByRole('image', { name: 'Hill loop' })).toBeTruthy();
    expect(accessibleElements()).toHaveLength(1);
  });

  it('hides every terrain snapshot worker and exposes nothing', async () => {
    await render(<TerrainSnapshotWebView />);

    const hidden = webViewsHidden();
    expect(hidden.length).toBeGreaterThan(0);
    expect(hidden.every(Boolean)).toBe(true);
    expect(accessibleElements()).toEqual([]);
  });
});

describe('map WebViews take no keyboard focus', () => {
  it('holds the 2D map surface in a focus block', async () => {
    await render(
      <MapSurface
        mapStyle="light"
        initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
        sources={{}}
        layers={[]}
      />
    );

    expect(webViewsBlocked()).toEqual([true]);
  });

  it('holds the 3D map in a focus block', async () => {
    await render(
      <Map3DWebView coordinates={[[7.4, 46.9]]} mapStyle="light" routesGeoJSON={EMPTY} />
    );

    expect(webViewsBlocked()).toEqual([true]);
  });

  it('holds every terrain snapshot worker in a focus block', async () => {
    await render(<TerrainSnapshotWebView />);

    const blocked = webViewsBlocked();
    expect(blocked.length).toBeGreaterThan(0);
    expect(blocked.every(Boolean)).toBe(true);
  });
});
