/**
 * Scenario: a 2D WebView surface routes its planet source through the tile store.
 *
 * Expected behaviour: Rust is handed the TileJSON URL, not a tile template. The
 * origin serves tiles from a dated snapshot segment only that document names and
 * answers the unversioned path with HTTP 200 and an empty body, so a template
 * fabricated as `/planet/{z}/{x}/{y}.pbf` draws nothing.
 */

import { rewriteVectorUrls } from '@/features/maps/components/mapStyles';
import { DARK_MATTER_STYLE } from '@/features/maps/components/darkMatterStyle';

const mockSetSourceTemplate = jest.fn();
jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    basemapStore: () => ({ setSourceTemplate: mockSetSourceTemplate }),
  })
);

const PLANET = 'https://tiles.openfreemap.org/planet';

beforeEach(() => mockSetSourceTemplate.mockClear());

describe('planet vector tiles resolve through the TileJSON', () => {
  it('hands Rust the TileJSON url and fabricates no tile path', () => {
    const rewritten = JSON.parse(JSON.stringify(rewriteVectorUrls(DARK_MATTER_STYLE)));
    const source = rewritten.sources.openmaptiles;

    expect(mockSetSourceTemplate).toHaveBeenCalledWith('openmaptiles', PLANET);
    for (const template of source.tiles as string[]) {
      expect(template).not.toMatch(/\/planet\/\{z\}/);
      expect(template).toMatch(/\{z\}\/\{x\}\/\{y\}\.pbf$/);
    }
    expect(source.url).toBeUndefined();
  });
});
