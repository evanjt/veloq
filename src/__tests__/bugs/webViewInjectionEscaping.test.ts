/**
 * Scenario: the scripts injected into the map WebViews interpolated strings
 * inside single quotes with no escaping, and the heatmap tile handler joined a
 * path the page posted straight onto the tile directory. The page runs MapLibre
 * GL JS fetched from a CDN.
 *
 * Expected behaviour: every interpolated string is a JavaScript literal, and a
 * posted tile path is `z/x/y.png` or nothing.
 */

import { jsLiteral } from '@/features/maps/lib/webViewLiterals';
import { buildMap3DHtml } from '@/features/maps/lib/htmlBuilders/map3D';
import { buildRenderSnapshotScript } from '@/features/maps/lib/htmlBuilders/terrainSnapshotScripts';

describe('a value interpolated into injected JavaScript', () => {
  it('is quoted and escaped', () => {
    expect(jsLiteral('#0D9488')).toBe('"#0D9488"');
    expect(jsLiteral("a'); alert(1); //")).toBe('"a\'); alert(1); //"');
    expect(jsLiteral('a"b')).toBe('"a\\"b"');
    expect(jsLiteral('a\\b')).toBe('"a\\\\b"');
  });

  it('has no literal it can be read outside of', () => {
    const roundTrip = (value: string) => eval(`(${jsLiteral(value)})`) as string;
    for (const hostile of ["'", '"', '\\', "');\n", '</script>']) {
      expect(roundTrip(hostile)).toBe(hostile);
    }
  });

  it('answers a literal null for a missing value', () => {
    expect(jsLiteral(undefined)).toBe('null');
    expect(jsLiteral(null)).toBe('null');
  });

  /// The generated scripts are evaluated for the interpolated value: a value
  /// that escaped its literal would read back as something else or not parse.
  describe('in the generated map scripts', () => {
    const hostile = 'x\'"); globalThis.__injected = 1; //\n</script>';

    const request = {
      activityId: 'a1',
      coordinates: [[7, 46]] as [number, number][],
      camera: { center: [7, 46] as [number, number], zoom: 10, bearing: 0, pitch: 0 },
      mapStyle: 'light' as const,
      routeColor: hostile,
    };

    it('reads the snapshot route colour back as the value it was given', () => {
      const script = buildRenderSnapshotScript(request, 0, 1);
      const literal = /var routeColor = (.*);\n/.exec(script)![1];
      expect(eval(`(${literal})`)).toBe(hostile);
      expect((globalThis as Record<string, unknown>).__injected).toBeUndefined();
    });

    it('reads the 3D view route colour back as the value it was given', () => {
      const html = buildMap3DHtml({
        coordinates: [[7, 46]],
        bounds: null,
        centerOverride: null,
        zoom: 10,
        bearing: 0,
        pitch: 0,
        hasSavedCamera: false,
        terrainExaggeration: 1,
        initStyle: 'light',
        mapStyle: 'light',
        routeColor: hostile,
        showHeatmap: false,
        devicePixelRatio: 2,
      });
      const literal = /'line-color': (".*"),\n\s*'line-width': 3,/.exec(html)![1];
      expect(eval(`(${literal})`)).toBe(hostile);
      expect((globalThis as Record<string, unknown>).__injected).toBeUndefined();
    });
  });
});
