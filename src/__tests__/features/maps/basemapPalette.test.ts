import { LIBERTY_STYLE } from '@/features/maps/styles/liberty';
import { DARK_MATTER_STYLE } from '@/features/maps/styles/darkMatter';
import { basemapTones } from '@/features/maps/styles/basemapTones';
import { mapPalette, mapStylePreview } from '@/theme';

// Scenario: the light and dark basemaps are drawn in the guide's five ground colours, so the
// data line is the only strong colour on the map. Expected behaviour: the ground, park, water
// and road layers carry the base's palette values, every other colour either style paints is a
// tone derived from those five, and the style thumbnails show the same ground.
type Layer = { id: string; paint?: Record<string, unknown> };

const COLOUR = /^(#[0-9a-f]{3,8}|rgba?\(.*\)|hsla?\(.*\))$/i;

function paintColours(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    if (COLOUR.test(value.trim())) out.push(value);
  } else if (Array.isArray(value)) {
    value.forEach((v) => paintColours(v, out));
  } else if (value && typeof value === 'object') {
    Object.values(value).forEach((v) => paintColours(v, out));
  }
  return out;
}

const layerById = (style: { layers: readonly unknown[] }, id: string) => {
  const layer = (style.layers as Layer[]).find((l) => l.id === id);
  if (!layer) throw new Error(`no layer ${id}`);
  return layer.paint ?? {};
};

const lower = (colour: unknown) => String(colour).toLowerCase();

describe.each([
  {
    base: 'light' as const,
    style: LIBERTY_STYLE,
    park: 'park',
    water: 'water',
    waterway: 'waterway_river',
    road: 'road_trunk_primary',
    label: 'label_other',
  },
  {
    base: 'dark' as const,
    style: DARK_MATTER_STYLE,
    park: 'landuse_park',
    water: 'water',
    waterway: 'waterway',
    road: 'highway_major_inner',
    label: 'place_other',
  },
])('the $base basemap', ({ base, style, park, water, waterway, road, label }) => {
  const palette = mapPalette(base);

  it('draws its ground in the base land colour', () => {
    expect(lower(layerById(style, 'background')['background-color'])).toBe(lower(palette.land));
  });

  it('draws parks, water and roads in the base palette', () => {
    expect(lower(layerById(style, park)['fill-color'])).toBe(lower(palette.park));
    expect(lower(layerById(style, water)['fill-color'])).toBe(lower(palette.water));
    expect(lower(layerById(style, waterway)['line-color'])).toBe(lower(palette.water));
    expect(lower(layerById(style, road)['line-color'])).toBe(lower(palette.road));
  });

  it('draws its place names in the base label colour', () => {
    expect(lower(layerById(style, label)['text-color'])).toBe(lower(palette.label));
  });

  it('draws no orange road casing', () => {
    expect(paintColours(style.layers).map(lower)).not.toContain('#e9ac77');
  });

  it('paints no colour that is not a tone of the base palette', () => {
    const tones = new Set(Object.values(basemapTones(palette)).map(lower));
    const offenders = (style.layers as Layer[]).flatMap((layer) =>
      paintColours(layer.paint)
        .filter((colour) => !tones.has(lower(colour)))
        .map((colour) => `${layer.id}: ${colour}`)
    );
    expect(offenders).toEqual([]);
  });
});

describe('the style thumbnails', () => {
  it.each(['light', 'dark'] as const)('show the %s base palette', (base) => {
    const { land, water, road } = mapPalette(base);
    expect(mapStylePreview[base]).toEqual({ land, water, road });
  });
});
