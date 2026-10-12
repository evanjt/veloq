/**
 * Scenario: iOS Smart Invert is on, which inverts every view that does not opt
 * out, so a map page drawn in a WebView would show its imagery and route hues
 * as a negative.
 *
 * Expected behaviour: the WebView of both the 2D and the 3D surface sits inside
 * a view that opts out, so the map is drawn as it is.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import type { ReactTestInstance } from 'react-test-renderer';

import { MapSurface } from '@/features/maps/components/MapSurface';
import { Map3DWebView } from '@/features/maps/components/Map3DWebView';

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  _props: object,
  ref: React.Ref<{
    injectJavaScript: (script: string) => void;
    reload: () => void;
    stopLoading: () => void;
  }>
) {
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: () => {},
    reload: () => {},
    stopLoading: () => {},
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

function optsOutOfInvert(node: ReactTestInstance): boolean {
  for (let at: ReactTestInstance | null = node; at; at = at.parent) {
    if (at.props.accessibilityIgnoresInvertColors === true) return true;
  }
  return false;
}

describe('a map surface under iOS Smart Invert', () => {
  it('keeps the 2D map page out of the inversion', async () => {
    const { UNSAFE_root } = await render(
      <MapSurface
        mapStyle="satellite"
        initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
        sources={{}}
        layers={[]}
      />
    );

    expect(optsOutOfInvert(UNSAFE_root.findByType(mockWebView))).toBe(true);
  });

  it('keeps the 3D map page out of the inversion', async () => {
    const { UNSAFE_root } = await render(
      <Map3DWebView
        coordinates={[[7.448, 46.949]]}
        mapStyle="satellite"
        routesGeoJSON={{ type: 'FeatureCollection', features: [] }}
      />
    );

    expect(optsOutOfInvert(UNSAFE_root.findByType(mockWebView))).toBe(true);
  });
});
