/**
 * Scenario: a WebView surface asks for a style without stating any options.
 * Expected behaviour: it gets the bundled light style on tile-store vector tiles.
 */

import {
  resolveStyleForWebView,
  LIGHT_STYLE_URL,
} from '@/features/maps/lib/htmlBuilders/styleResolution';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: jest.fn() }),
  })
);

describe('resolveStyleForWebView', () => {
  it('serves the bundled light style when the caller states nothing', () => {
    const resolved = resolveStyleForWebView('light');
    expect(resolved.url).toBeNull();
    expect(resolved.inline).not.toBeNull();
  });

  it('uses the hosted light style when explicitly requested', () => {
    const resolved = resolveStyleForWebView('light', { bundledLightStyle: false });
    expect(resolved.inline).toBeNull();
    expect(resolved.url).toBe(LIGHT_STYLE_URL);
  });

  it('keeps dark and satellite inline either way', () => {
    for (const options of [{}, { bundledLightStyle: false }]) {
      expect(resolveStyleForWebView('dark', options).inline).not.toBeNull();
      expect(resolveStyleForWebView('satellite', options).inline).not.toBeNull();
    }
  });

  it('routes vector tiles through the store by default', () => {
    const cached = JSON.stringify(resolveStyleForWebView('dark').inline);
    const uncached = JSON.stringify(
      resolveStyleForWebView('dark', { cacheVectorTiles: false }).inline
    );
    expect(cached).toContain('/veloq-tile/');
    expect(uncached).not.toContain('/veloq-tile/');
  });
});
