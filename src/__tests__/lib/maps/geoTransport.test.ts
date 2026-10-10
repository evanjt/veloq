/**
 * Scenario: one activity's line is answered by Rust as GeoJSON at a URL on
 * the map page's own origin, so a source can point at it rather than carry
 * the line as text.
 *
 * Expected behaviour: the URL sits beside the tile URLs on each platform's
 * origin, and its revision is a query string, so a re-ingest that moves the
 * revision moves the URL and the page fetches the line again.
 */

import { Platform } from 'react-native';

import { nativeGeoUrl } from '@/features/maps/lib/tileTransport';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides({}));

function onPlatform(os: 'android' | 'ios') {
  Object.defineProperty(Platform, 'OS', { value: os, configurable: true });
}

afterEach(() => onPlatform('android'));

describe('where the page asks for an activity line', () => {
  it('asks the interceptor on Android, on the page own origin', () => {
    onPlatform('android');

    expect(nativeGeoUrl('track', 'i9001', 0)).toBe('https://veloq.fit/veloq-geo/track/i9001?v=0');
  });

  it('asks the scheme handler on iOS, on the page own origin', () => {
    onPlatform('ios');

    expect(nativeGeoUrl('track', 'i9001', 2)).toBe('veloq-tile://map/veloq-geo/track/i9001?v=2');
  });

  it('moves the URL when the revision moves and only then', () => {
    expect(nativeGeoUrl('track', 'i9001', 1)).toBe(nativeGeoUrl('track', 'i9001', 1));
    expect(nativeGeoUrl('track', 'i9001', 1)).not.toBe(nativeGeoUrl('track', 'i9001', 2));
  });

  it('keeps a key with a separator in it inside one path segment', () => {
    expect(nativeGeoUrl('track', '../x', 0)).toBe('https://veloq.fit/veloq-geo/track/..%2Fx?v=0');
  });
});
