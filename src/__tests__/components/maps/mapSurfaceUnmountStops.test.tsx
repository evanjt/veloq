/**
 * Scenario: a map surface unmounts while its WebView is still loading a page.
 *
 * Expected behaviour: the unmount cleanup reaches the WebView and stops it.
 * The cleanup read `webViewRef.current` at teardown, by which time React has
 * already detached the ref, so the optional call silently did nothing and the
 * page went on loading.
 */

import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';

import { MapSurface } from '@/features/maps/components/MapSurface';
import { Map3DWebView } from '@/features/maps/components/Map3DWebView';

const stopLoading = jest.fn();

jest.mock('react-native-webview', () => ({
  get WebView() {
    return mockWebView;
  },
}));

const mockWebView = React.forwardRef(function MockWebView(
  props: { onMessage: (event: { nativeEvent: { data: string } }) => void },
  ref: React.Ref<{
    injectJavaScript: (script: string) => void;
    reload: () => void;
    stopLoading: () => void;
  }>
) {
  React.useImperativeHandle(ref, () => ({
    injectJavaScript: () => {},
    reload: () => {},
    stopLoading,
  }));
  return <View />;
});

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: true }) }));

beforeEach(() => stopLoading.mockClear());

describe('a map surface that unmounts mid-load', () => {
  it('stops the WebView the 3D surface was holding', () => {
    const view = render(
      <Map3DWebView
        coordinates={[[7.448, 46.949]]}
        mapStyle="light"
        routesGeoJSON={{ type: 'FeatureCollection', features: [] }}
      />
    );

    view.unmount();

    expect(stopLoading).toHaveBeenCalledTimes(1);
  });

  it('stops the WebView it was holding', () => {
    const view = render(
      <MapSurface
        mapStyle="light"
        initialCamera={{ center: [7.448, 46.949], zoom: 12 }}
        sources={{}}
        layers={[]}
      />
    );

    view.unmount();

    expect(stopLoading).toHaveBeenCalledTimes(1);
  });
});
