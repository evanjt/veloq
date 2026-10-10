/**
 * Scenario: the map read hands the section overlay over stamped with the database state it
 * was read in, and every filter change or keystroke reads the map again.
 *
 * Expected behaviour: the overlay is decoded once per stamp. A read that comes back under
 * the same stamp, whether it left the lines out or carried fresh buffers, hands back the
 * identical overlay, so the surface patcher serialises nothing for the sections source. A
 * section whose line has fewer than two finite points is left out, because a LineString of
 * one point or a non-finite pair crashes the iOS renderer.
 */
import * as coords from 'veloqrs/src/coords';
import { sectionPalette, sectionPaletteIndex } from '@/theme/colors';
import { createSectionLineCache } from '@/features/maps/lib/sectionLineCollection';
import { createSurfacePatcher } from '@/features/maps/lib/mapSurfacePatch';

import { encodeTrack } from '../__shared__/trackBytes';

jest.mock('veloqrs/src/coords', () => {
  const actual = jest.requireActual('veloqrs/src/coords');
  return { ...actual, decodeCoordsFlat: jest.fn(actual.decodeCoordsFlat) };
});

const decodeCoordsFlat = coords.decodeCoordsFlat as jest.MockedFunction<
  typeof coords.decodeCoordsFlat
>;

const section = (id: string, pts: [number, number][]) => ({
  id,
  name: `Lane ${id}`,
  sportTypes: ['Ride'],
  visitCount: 3,
  distanceMeters: 1500,
  encodedPolyline: encodeTrack(pts.map(([latitude, longitude]) => ({ latitude, longitude }))),
});

const twoSections = () => [
  section('s1', [
    [46.5, 6.6],
    [46.51, 6.61],
  ]),
  section('s2', [
    [10, 20],
    [11, 21],
    [12, 22],
  ]),
];

beforeEach(() => decodeCoordsFlat.mockClear());

describe('section line collection', () => {
  it('draws each section as a LineString in lng, lat order with its fields and colour', () => {
    const overlay = createSectionLineCache().overlay({ stamp: 1, sections: twoSections() });

    expect(overlay.collection.features).toHaveLength(2);
    expect(overlay.collection.features[0]).toEqual({
      type: 'Feature',
      id: 's1',
      properties: {
        id: 's1',
        name: 'Lane s1',
        visitCount: 3,
        distanceMeters: 1500,
        color: sectionPalette[sectionPaletteIndex('s1')],
      },
      geometry: {
        type: 'LineString',
        coordinates: [
          [6.6, 46.5],
          [6.61, 46.51],
        ],
      },
    });
    expect(overlay.sections.map((s) => s.id)).toEqual(['s1', 's2']);
    expect(overlay.sections[0]).toEqual({
      id: 's1',
      name: 'Lane s1',
      visitCount: 3,
      distanceMeters: 1500,
    });
  });

  it('leaves out a section with fewer than two finite points, and drops only the bad pairs', () => {
    decodeCoordsFlat
      .mockReturnValueOnce(new Float64Array([46.5, 6.6]))
      .mockReturnValueOnce(new Float64Array([NaN, 6.6, 46.5, 6.6]))
      .mockReturnValueOnce(new Float64Array([Infinity, 6.6, 46.5, -Infinity, 46.6, 6.7]))
      .mockReturnValueOnce(new Float64Array([46.5, 6.6, NaN, NaN, 46.6, 6.7, 46.7, 6.8]));
    const overlay = createSectionLineCache().overlay({
      stamp: 1,
      sections: [section('one', []), section('nan', []), section('inf', []), section('ok', [])],
    });

    expect(overlay.collection.features.map((f) => f.id)).toEqual(['ok']);
    expect(overlay.collection.features[0]?.geometry).toEqual({
      type: 'LineString',
      coordinates: [
        [6.6, 46.5],
        [6.7, 46.6],
        [6.8, 46.7],
      ],
    });
    // A section the map cannot draw is still one the chooser can name.
    expect(overlay.sections.map((s) => s.id)).toEqual(['one', 'nan', 'inf', 'ok']);
  });

  it('colours a section by its id, so the list order and the activity map agree', () => {
    const ids = ['sec-a', 'sec-b', 'sec-c', 'sec-d', 'sec-e', 'sec-f', 'sec-g'];
    const draw = (order: string[]) =>
      createSectionLineCache().overlay({
        stamp: 1,
        sections: order.map((id) =>
          section(id, [
            [1, 2],
            [3, 4],
          ])
        ),
      }).collection.features;
    const forward = draw(ids);
    const reversed = draw([...ids].reverse());
    const colourOf = (fs: GeoJSON.Feature[], id: string) =>
      fs.find((f) => f.id === id)?.properties?.color;

    for (const id of ids) {
      expect(colourOf(forward, id)).toBe(sectionPalette[sectionPaletteIndex(id)]);
      expect(colourOf(reversed, id)).toBe(colourOf(forward, id));
    }
    expect(forward[0]?.properties).not.toHaveProperty('patternIndex');
  });

  it('is an empty collection, never null, with no sections, so the source stays mounted', () => {
    const overlay = createSectionLineCache().overlay({ stamp: 1, sections: [] });
    expect(overlay.collection).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('hands back the identical overlay under one stamp, with the lines left out or resent', () => {
    const cache = createSectionLineCache();
    const first = cache.overlay({ stamp: 4, sections: twoSections() });
    expect(cache.stamp()).toBe(4);

    expect(cache.overlay({ stamp: 4, sections: undefined })).toBe(first);
    expect(cache.overlay({ stamp: 4, sections: twoSections() })).toBe(first);
    expect(decodeCoordsFlat).toHaveBeenCalledTimes(2);

    const moved = cache.overlay({ stamp: 5, sections: twoSections() });
    expect(moved).not.toBe(first);
    expect(moved.collection).not.toBe(first.collection);
    expect(cache.stamp()).toBe(5);
  });

  it('holds nothing when the overlay is off, and starts again from the next stamped read', () => {
    const cache = createSectionLineCache();
    cache.overlay({ stamp: 4, sections: twoSections() });

    const off = cache.overlay(undefined);
    expect(off.collection.features).toEqual([]);
    expect(off.sections).toEqual([]);
    expect(cache.stamp()).toBeUndefined();

    expect(cache.overlay({ stamp: 4, sections: twoSections() }).sections).toHaveLength(2);
  });

  it('holds no stamp for an unstamped read, so every read decodes again', () => {
    const cache = createSectionLineCache();
    const first = cache.overlay({ stamp: undefined, sections: twoSections() });
    expect(cache.stamp()).toBeUndefined();

    const second = cache.overlay({ stamp: undefined, sections: twoSections() });
    expect(second).not.toBe(first);
    expect(decodeCoordsFlat).toHaveBeenCalledTimes(4);
  });

  it('draws nothing for lines left out under a stamp it does not hold', () => {
    const cache = createSectionLineCache();
    cache.overlay({ stamp: 4, sections: twoSections() });

    const stray = cache.overlay({ stamp: 9, sections: undefined });
    expect(stray.collection.features).toEqual([]);
    expect(cache.stamp()).toBeUndefined();
  });

  it('leaves the patcher nothing to serialise for the sections on a filter re-read', () => {
    const cache = createSectionLineCache();
    const patcher = createSurfacePatcher();
    // The markers are a new object on every read, as a filter change makes them.
    const sources = (sections: GeoJSON.FeatureCollection) => ({
      sources: {
        markers: {
          kind: 'geojson' as const,
          data: { type: 'FeatureCollection' as const, features: [] },
        },
        sections: { kind: 'geojson' as const, data: sections },
      },
      layers: [],
    });

    const first = cache.overlay({ stamp: 4, sections: twoSections() }).collection;
    patcher.next(sources(first));

    const filtered = patcher.next(
      sources(cache.overlay({ stamp: 4, sections: undefined }).collection)
    );
    // An equal collection that is a new object is what a rebuild on every read hands over.
    const rebuilt = patcher.next(sources(structuredClone(first)));

    expect(filtered.patch?.sources?.sections).toBeUndefined();
    expect(rebuilt.serialised - filtered.serialised).toBe(1);
  });
});
