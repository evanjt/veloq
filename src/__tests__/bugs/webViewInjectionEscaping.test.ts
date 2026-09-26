/**
 * Scenario: the scripts injected into the map WebViews interpolated strings
 * inside single quotes with no escaping, and the heatmap tile handler joined a
 * path the page posted straight onto the tile directory. The page runs MapLibre
 * GL JS fetched from a CDN.
 *
 * Expected behaviour: every interpolated string is a JavaScript literal, and a
 * posted tile path is `z/x/y.png` or nothing.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { heatmapTilePath, jsLiteral } from '@/features/maps/lib/webViewLiterals';

const source = (relative: string) => readFileSync(resolve(__dirname, '../..', relative), 'utf8');

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

  /// The three builders the audit named, read from the tree: no single-quoted
  /// interpolation may remain in any of them.
  it.each([
    'features/maps/lib/htmlBuilders/terrainSnapshotScripts.ts',
    'features/maps/lib/htmlBuilders/map3D.ts',
    'features/maps/components/Map3DWebView.tsx',
  ])('is what %s interpolates with', (file) => {
    const quoted = source(file).match(/'\$\{[^}]+\}'/g) ?? [];
    expect(quoted).toEqual([]);
  });
});

describe('a heatmap tile path posted by the page', () => {
  it('is accepted when it is z/x/y.png', () => {
    expect(heatmapTilePath('12/2130/1450.png')).toBe('12/2130/1450.png');
    expect(heatmapTilePath('0/0/0.png')).toBe('0/0/0.png');
  });

  it('is refused when it climbs out of the tile directory', () => {
    expect(heatmapTilePath('../../etc/passwd')).toBeNull();
    expect(heatmapTilePath('12/../../1450.png')).toBeNull();
    expect(heatmapTilePath('/12/2130/1450.png')).toBeNull();
  });

  it('is refused when it is not a tile at all', () => {
    expect(heatmapTilePath('12/2130/1450.js')).toBeNull();
    expect(heatmapTilePath('12/2130.png')).toBeNull();
    expect(heatmapTilePath('')).toBeNull();
    expect(heatmapTilePath(undefined)).toBeNull();
    expect(heatmapTilePath(42)).toBeNull();
  });

  it.each(['features/maps/hooks/useMap3DBridge.ts', 'features/maps/components/MapSurface.tsx'])(
    'is checked before %s joins it onto the tile directory',
    (file) => {
      const text = source(file);
      expect(text).toContain('heatmapTilePath(data.tilePath)');
      expect(text).not.toMatch(/const tilePath = data\.tilePath as string/);
    }
  );
});
