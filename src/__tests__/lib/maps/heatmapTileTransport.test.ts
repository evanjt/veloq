/**
 * Scenario: heatmap tiles are PNGs a Rust pass writes to the app's cache
 * directory. A page cannot read that directory, so every tile was requested
 * over the React Native bridge and answered as base64, measured at 47.8 ms a
 * tile against 6.6 ms intercepted.
 *
 * Expected behaviour: on Android the raster source asks the interceptor for an
 * ordinary URL, which Rust answers off disk, and on iOS it asks the scheme
 * handler on the page's custom-scheme origin. Where nothing can claim the URL
 * the source keeps the `heatmap-file` protocol.
 */

import { Platform } from 'react-native';

import {
  HEATMAP_TILE_PROTOCOL_URL,
  heatmapTileTemplate,
} from '@/features/maps/hooks/useHeatmapTiles';
import { nativeHeatmapTileUrl } from '@/features/maps/lib/tileTransport';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides({}));
jest.mock('expo-file-system/legacy', () => ({ cacheDirectory: 'file:///cache/' }));

function onPlatform(os: 'android' | 'ios' | 'web') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

afterEach(() => onPlatform('android'));

describe('where the page asks for a heatmap tile', () => {
  it('asks the interceptor on Android, on the page own origin', () => {
    onPlatform('android');

    expect(nativeHeatmapTileUrl()).toBe('https://veloq.fit/veloq-tile/heatmap/{z}/{x}/{y}.png');
    expect(heatmapTileTemplate()).toBe(nativeHeatmapTileUrl());
  });

  it('asks the scheme handler on iOS, on the page own origin', () => {
    onPlatform('ios');

    expect(nativeHeatmapTileUrl()).toBe('veloq-tile://map/veloq-tile/heatmap/{z}/{x}/{y}.png');
    expect(heatmapTileTemplate()).toBe(nativeHeatmapTileUrl());
  });

  it('keeps the bridge protocol where nothing can intercept', () => {
    onPlatform('web');

    expect(nativeHeatmapTileUrl()).toBeNull();
    expect(heatmapTileTemplate()).toBe(HEATMAP_TILE_PROTOCOL_URL);
  });

  it('hands Rust no template, because the heatmap is drawn rather than fetched', () => {
    onPlatform('android');
    const { basemapStore } = jest.requireMock('veloqrs');

    nativeHeatmapTileUrl();

    expect(basemapStore).not.toHaveBeenCalled();
  });
});
