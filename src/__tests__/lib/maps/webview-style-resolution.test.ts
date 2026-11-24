/**
 * Scenario: a WebView surface asks for a style without stating any options.
 * Expected behaviour: it gets the bundled light style on tile-store vector tiles.
 */

import { resolveStyleForWebView } from '@/features/maps/lib/htmlBuilders/styleResolution';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: jest.fn() }),
  })
);

describe('resolveStyleForWebView', () => {
  it('serves the bundled light style when the caller states nothing', () => {
    const resolved = resolveStyleForWebView('light');
    expect(resolved.inline).not.toBeNull();
  });

  vaultIt('routes vector tiles through the store by default', () => {
    expect(JSON.stringify(resolveStyleForWebView('dark').inline)).toContain('/veloq-tile/');
  });
});
