/**
 * Scenario: the map's paint colours are resolved values, so a hex written beside the
 * token file drifts from the table swatch and the app.
 *
 * Expected behaviour: compare, brush and ground colours equal the token file's values for
 * the base's scheme.
 */

import { colourTokens } from '@/theme/colourTokens.generated';
import { mapPalette } from '@/theme/palette';

import { COMPARE_TOKENS, compareColours } from '../../../web/connect/charts/colours';
import { brushColour, compareColoursOn } from '../../../web/connect/map/activityLayers';
import { pageStyle } from '../../../web/connect/map/style';

describe('map colours read the token file', () => {
  it.each(['light', 'dark'] as const)('compare colours equal the %s tokens', (tone) => {
    const table = colourTokens[tone] as Record<string, string>;
    for (const [line, token] of Object.entries(COMPARE_TOKENS))
      expect(compareColours(tone)[line]).toBe(table[token]);
  });

  it('the satellite base draws the dark scheme', () => {
    expect(compareColoursOn('satellite')).toEqual(compareColours('dark'));
    expect(compareColoursOn('light')).toEqual(compareColours('light'));
  });

  it('the brush is a token of the base scheme', () => {
    expect(brushColour('light')).toBe(colourTokens.light['data-div-warm-2']);
    expect(brushColour('dark')).toBe(colourTokens.dark['data-div-warm-2']);
  });

  it('the satellite ground is the dark base land', () => {
    const layers = (pageStyle('satellite') as { layers: { paint?: Record<string, string> }[] })
      .layers;
    expect(layers[0]?.paint?.['background-color']).toBe(mapPalette('dark').land);
  });
});
