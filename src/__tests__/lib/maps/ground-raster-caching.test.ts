/**
 * Scenario: the light style paints the `ne2_shaded` raster below z7, which is
 * the whole visible ground at world zoom.
 *
 * Expected behaviour: it is fetched through the tile store like every other
 * basemap tile, so a map opened with the radio off still has ground.
 */

import { resolveStyleForWebView } from '@/features/maps/lib/htmlBuilders/styleResolution';
import { buildMap3DHtml, buildMapSurfaceHtml } from '@/features/maps/lib/htmlBuilders';

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: jest.fn() }),
  })
);

const RASTER_ORIGIN = 'https://tiles.openfreemap.org/natural_earth';
const STORE_URL = 'veloq-tile://map/veloq-tile/ne2_shaded/{z}/{x}/{y}.png';

describe('the light style ground raster', () => {
  it('is rewritten onto the tile store', () => {
    const style = JSON.stringify(resolveStyleForWebView('light').inline);
    expect(style).toContain(STORE_URL);
    expect(style).not.toContain(RASTER_ORIGIN);
  });

  it('routes the 3D light ground raster through the store', () => {
    const html = buildMap3DHtml({ initStyle: 'light', mapStyle: 'light' } as never);
    expect(html).toContain(STORE_URL);
    expect(html).not.toContain(RASTER_ORIGIN);
  });

  it('leaves the dark style alone, which never carried the raster', () => {
    const style = JSON.stringify(resolveStyleForWebView('dark').inline);
    expect(style).not.toContain('ne2_shaded');
    expect(style).not.toContain(RASTER_ORIGIN);
  });
});

describe('the built 2D surface', () => {
  const html = buildMapSurfaceHtml({
    style: 'light',
    camera: { center: [0, 0], zoom: 3 },
    interaction: {},
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

  it('names the store URL and no raw raster URL', () => {
    expect(html).toContain(STORE_URL);
    expect(html).not.toContain('https://tiles.openfreemap.org/natural_earth');
  });
});
