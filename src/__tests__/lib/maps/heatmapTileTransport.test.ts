/**
 * Scenario: heatmap tiles are PNGs a Rust pass writes to the app's cache
 * directory. A page cannot read that directory, so every tile was requested
 * over the React Native bridge and answered as base64, measured at 47.8 ms a
 * tile against 6.6 ms intercepted.
 *
 * Expected behaviour: on Android the raster source asks the interceptor for an
 * ordinary URL, which Rust answers off disk, and on iOS it asks the scheme
 * handler on the page's custom-scheme origin. The base map is in the path, so
 * each base asks for its own colours and a base change is a new URL.
 */

import { Platform } from 'react-native';

import { heatmapTileTemplate } from '@/features/maps/lib/heatmapTiles';
import { nativeHeatmapTileUrl } from '@/features/maps/lib/tileTransport';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides({}));

function onPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

afterEach(() => onPlatform('android'));

describe('where the page asks for a heatmap tile', () => {
  it('asks the interceptor on Android, on the page own origin', () => {
    onPlatform('android');

    expect(nativeHeatmapTileUrl('light')).toBe(
      'https://veloq.fit/veloq-tile/heatmap-light/{z}/{x}/{y}.png'
    );
    expect(heatmapTileTemplate('light')).toBe(nativeHeatmapTileUrl('light'));
  });

  it('asks the scheme handler on iOS, on the page own origin', () => {
    onPlatform('ios');

    expect(nativeHeatmapTileUrl('satellite')).toBe(
      'veloq-tile://map/veloq-tile/heatmap-satellite/{z}/{x}/{y}.png'
    );
    expect(heatmapTileTemplate('satellite')).toBe(nativeHeatmapTileUrl('satellite'));
  });

  it('asks each base map under a source of its own', () => {
    onPlatform('android');
    const templates = (['light', 'dark', 'satellite'] as const).map((base) =>
      heatmapTileTemplate(base, 2)
    );

    expect(new Set(templates).size).toBe(3);
    expect(heatmapTileTemplate('dark', 2)).toBe(
      'https://veloq.fit/veloq-tile/heatmap-dark/{z}/{x}/{y}.png?v=2'
    );
  });

  it('hands Rust no template, because the heatmap is drawn rather than fetched', () => {
    onPlatform('android');
    const { basemapStore } = jest.requireMock('veloqrs');

    nativeHeatmapTileUrl('dark');

    expect(basemapStore).not.toHaveBeenCalled();
  });
});
