/**
 * Scenario: colour by gradient is on while the 3D page is up, then the basemap changes.
 *
 * Expected behaviour: the host sends the gradient expression to the page, a null
 * clears it, the route source carries line metrics so line-progress resolves,
 * and the style swap rebuilds the route layer with the held expression.
 */
import { buildMap3DHtml, buildStyleOverlayScript } from '../htmlBuilders';
import { buildSetRouteGradientScript } from '../htmlBuilders/map3DScripts';
import { colors } from '@/theme';

const expression = [
  'interpolate',
  ['linear'],
  ['line-progress'],
  0,
  colors.success,
  1,
  colors.error,
];

describe('3D route gradient', () => {
  it('sends the expression to the page when the toggle is on', () => {
    const script = buildSetRouteGradientScript(expression);
    expect(script).toContain('window._veloq3d.setRouteGradient(');
    expect(script).toContain(JSON.stringify(expression));
  });

  it('sends null when the toggle is off', () => {
    expect(buildSetRouteGradientScript(null)).toContain('setRouteGradient(null)');
  });

  it('builds the route source with line metrics and re-applies the gradient after a style swap', () => {
    const html = buildMap3DHtml({
      coordinates: [],
      bounds: null,
      centerOverride: null,
      zoom: 1,
      bearing: 0,
      pitch: 0,
      hasSavedCamera: false,
      terrainExaggeration: 1,
      initStyle: 'light',
      mapStyle: 'light',
      routeColor: colors.success,
      showHeatmap: false,
      devicePixelRatio: 1,
    });
    expect(html).toContain('lineMetrics: true');
    expect(buildStyleOverlayScript()).toContain('lineMetrics: true');
    expect(buildStyleOverlayScript()).toContain("'line-gradient'");
  });
});
