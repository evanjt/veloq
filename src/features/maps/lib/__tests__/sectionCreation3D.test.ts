/**
 * Scenario: section creation in 3D after a style switch re-adds its layers.
 *
 * Expected behaviour: the page and the re-add script draw the 2D geometry from
 * one definition: an 11 px marker with a 2 px casing stroke and a 6 px line
 * with no casing layer.
 */
import { buildMap3DHtml } from '../htmlBuilders';
import {
  sectionCreation3DLayers,
  sectionCreationLinePaint,
  sectionCreationMarkerPaint,
} from '../sectionCreationPaint';
import { colors, mapPalette } from '@/theme';

const palette = mapPalette('light');

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
  routeColor: colors.successFill,
  showHeatmap: false,
  devicePixelRatio: 1,
  reduceMotion: false,
});

describe('3D section creation layers', () => {
  it('draw the shared marker and line paint, without the old casing layers', () => {
    expect(html).toContain(JSON.stringify(sectionCreationMarkerPaint('type', palette)));
    expect(html).toContain(JSON.stringify(sectionCreationLinePaint(palette)['line-color']));
    expect(html).not.toContain('section-creation-line-outline');
    expect(html).not.toContain('section-creation-marker-border');
    expect(sectionCreationMarkerPaint('type', palette)['circle-radius']).toBe(11);
    expect(sectionCreationMarkerPaint('type', palette)['circle-stroke-width']).toBe(2);
    expect(sectionCreationMarkerPaint('type', palette)['circle-stroke-color']).toBe(palette.casing);
  });

  it('use the colour 2D uses for the line, hidden until creation starts', () => {
    const [line, marker] = sectionCreation3DLayers(false, palette);
    expect(line).toMatchObject({
      paint: { 'line-color': sectionCreationLinePaint(palette)['line-color'] },
    });
    expect(line!.layout.visibility).toBe('none');
    expect(marker!.layout.visibility).toBe('none');
    expect(sectionCreation3DLayers(true, palette)[0]!.layout).not.toHaveProperty('visibility');
  });
});
