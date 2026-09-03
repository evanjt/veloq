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
