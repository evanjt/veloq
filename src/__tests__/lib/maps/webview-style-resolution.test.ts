/**
 * Scenario: a WebView surface asks for a style without stating any options.
 * Expected behaviour: it gets the bundled light style on cached vector tiles,
 * which is what every 2D surface wants, and only the 3D paths opt out.
 */

import {
  resolveStyleForWebView,
  LIGHT_STYLE_URL,
  TERRAIN_STYLE_OPTIONS,
} from '@/features/maps/lib/htmlBuilders/styleResolution';

// The page protocols are the web's transport now that both handsets intercept
// on the page's own origin, so this runs where nothing can intercept. Set at
// load, since a page built at describe time reads it before any hook runs.
import { Platform } from 'react-native';

const platform = Platform.OS;
Object.defineProperty(Platform, 'OS', { value: 'web', configurable: true });
afterAll(() => Object.defineProperty(Platform, 'OS', { value: platform, configurable: true }));

describe('resolveStyleForWebView', () => {
  it('serves the bundled light style when the caller states nothing', () => {
    const resolved = resolveStyleForWebView('light');
    expect(resolved.url).toBeNull();
    expect(resolved.inline).not.toBeNull();
  });

  it('leaves the light style on its URL for the 3D surfaces', () => {
    const resolved = resolveStyleForWebView('light', TERRAIN_STYLE_OPTIONS);
    expect(resolved.inline).toBeNull();
    expect(resolved.url).toBe(LIGHT_STYLE_URL);
  });

  it('keeps dark and satellite inline either way', () => {
    for (const options of [{}, TERRAIN_STYLE_OPTIONS]) {
      expect(resolveStyleForWebView('dark', options).inline).not.toBeNull();
      expect(resolveStyleForWebView('satellite', options).inline).not.toBeNull();
    }
  });

  it('caches vector tiles by default and not for 3D', () => {
    const cached = JSON.stringify(resolveStyleForWebView('dark').inline);
    const uncached = JSON.stringify(resolveStyleForWebView('dark', TERRAIN_STYLE_OPTIONS).inline);
    expect(cached).toContain('cached-vector://');
    expect(uncached).not.toContain('cached-vector://');
  });
});
