/**
 * Scenario: after a re-cut the detection preview draws the retired sections and the whole
 * catalogue the screen read returned, and a tap on one line names the sections on its ground.
 *
 * Expected behaviour: retired and current rows each draw in their own collection carrying their
 * pair ids, a hidden current row is flagged, a row with no line stays in the list and out of the
 * collections, and a selection marks the selected line and its pairs and nothing else.
 */
import {
  buildRetiredLines,
  busiestCentre,
  describeRetiredSelection,
} from '@/features/routes/lib/retiredLineCollection';
import type { LngLat } from '@/features/maps/lib/coordinates';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides({}));

// Link values as the engine's enum carries them; the builder compares by name through the stub.
const { RetiredPairLink } = require('../__shared__/veloqrsStub');

const NORTH: LngLat[] = [
  [7.44, 46.95],
  [7.45, 46.96],
];
const SOUTH: LngLat[] = [
  [7.44, 46.9],
  [7.45, 46.91],
];
const FAR: LngLat[] = [
  [8.9, 47.3],
  [8.91, 47.31],
];

const lines: Record<number, LngLat[]> = { 1: NORTH, 2: SOUTH, 3: FAR };
const buf = (n: number): ArrayBuffer => new Uint8Array([n]).buffer;
const decode = (b: ArrayBuffer): LngLat[] => lines[new Uint8Array(b)[0] ?? 0] ?? [];
const NO_LINE = new ArrayBuffer(0);

function retired(id: string, line: ArrayBuffer | undefined, over = {}) {
  return {
    section: {
      sectionId: id,
      kind: 'dissolved',
      at: '2026-10-01T00:00:00Z',
      versions: [],
      name: `Old ${id}`,
      ...over,
    },
    ...(line ? { encodedPolyline: line } : {}),
  };
}

function current(id: string, line: ArrayBuffer, over = {}) {
  return {
    id,
    name: `New ${id}`,
    isUserDefined: false,
    pinned: false,
    hidden: false,
    encodedPolyline: line,
    ...over,
  };
}

const DATA = {
  retired: [retired('r-north', buf(1)), retired('r-bare', undefined), retired('r-far', buf(3))],
  current: [
    current('c-north', buf(1)),
    current('c-hidden', buf(1), { hidden: true, supersededBy: 'c-north' }),
    current('c-south', buf(2)),
    current('c-empty', NO_LINE),
  ],
  pairs: [
    { retiredId: 'r-north', currentId: 'c-north', link: RetiredPairLink.Ground, overlap: 0.82 },
    { retiredId: 'r-north', currentId: 'c-hidden', link: RetiredPairLink.Supersedes },
  ],
};

const ids = (c: GeoJSON.FeatureCollection) => c.features.map((f) => f.properties?.id);

describe('the retired lines', () => {
  it('draws each retired and each current row in its own collection', () => {
    const { retired: r, current: c } = buildRetiredLines(DATA, { decode });

    expect(ids(r)).toEqual(['r-north', 'r-far']);
    expect(ids(c)).toEqual(['c-north', 'c-hidden', 'c-south']);
  });

  it('leaves a row with no decodable line out of the collections and keeps it in the list', () => {
    const { retired: r, current: c, rows } = buildRetiredLines(DATA, { decode });

    expect(ids(r)).not.toContain('r-bare');
    expect(ids(c)).not.toContain('c-empty');
    expect(rows.map((row) => row.id)).toEqual(['r-north', 'r-bare', 'r-far']);
    expect(rows.find((row) => row.id === 'r-bare')?.hasLine).toBe(false);
  });

  it('carries the pair ids on both sides of a pair', () => {
    const { retired: r, current: c } = buildRetiredLines(DATA, { decode });

    expect(r.features[0]?.properties?.pairIds).toBe('c-north,c-hidden');
    expect(c.features[0]?.properties?.pairIds).toBe('r-north');
    expect(c.features[2]?.properties?.pairIds).toBe('');
  });

  it('flags a hidden current row', () => {
    const { current: c } = buildRetiredLines(DATA, { decode });

    expect(c.features.map((f) => f.properties?.hidden)).toEqual([false, true, false]);
  });

  it('keeps only the lines that touch the area', () => {
    const area = { sw: [7.4, 46.9] as LngLat, ne: [7.5, 47.0] as LngLat };
    const { retired: r, current: c, rows } = buildRetiredLines(DATA, { decode, area });

    expect(ids(r)).toEqual(['r-north']);
    expect(ids(c)).toEqual(['c-north', 'c-hidden', 'c-south']);
    expect(rows).toHaveLength(3);
  });

  it('marks nothing as selected before a tap', () => {
    const { retired: r, current: c, selection } = buildRetiredLines(DATA, { decode });

    expect([...r.features, ...c.features].every((f) => f.properties?.role === 'idle')).toBe(true);
    expect(selection.features).toHaveLength(0);
  });

  it('marks the selected line and its pairs and nothing else', () => {
    const {
      retired: r,
      current: c,
      selection,
    } = buildRetiredLines(DATA, {
      decode,
      selectedId: 'r-north',
    });

    const role = (f: GeoJSON.Feature) => `${f.properties?.id}:${f.properties?.role}`;
    expect(r.features.map(role)).toEqual(['r-north:selected', 'r-far:other']);
    expect(c.features.map(role)).toEqual(['c-north:pair', 'c-hidden:pair', 'c-south:other']);
    expect(ids(selection)).toEqual(['r-north', 'c-north', 'c-hidden']);
  });

  it('selects from the current side and reaches the retired line it pairs with', () => {
    const { retired: r, current: c } = buildRetiredLines(DATA, { decode, selectedId: 'c-north' });

    expect(c.features[0]?.properties?.role).toBe('selected');
    expect(r.features[0]?.properties?.role).toBe('pair');
    expect(c.features[1]?.properties?.role).toBe('other');
  });

  it('is empty for an empty read', () => {
    const empty = buildRetiredLines({ retired: [], current: [], pairs: [] }, { decode });

    expect(empty.retired.features).toHaveLength(0);
    expect(empty.current.features).toHaveLength(0);
    expect(empty.rows).toHaveLength(0);
  });
});

describe('naming the pair of a tapped line', () => {
  it('names each current section on a retired section’s ground with its link', () => {
    const named = describeRetiredSelection(DATA, 'r-north');

    expect(named?.kind).toBe('retired');
    expect(named?.name).toBe('Old r-north');
    expect(named?.pairs).toEqual([
      {
        id: 'c-north',
        name: 'New c-north',
        kind: 'current',
        link: 'ground',
        overlap: 0.82,
        hidden: false,
      },
      {
        id: 'c-hidden',
        name: 'New c-hidden',
        kind: 'current',
        link: 'supersedes',
        overlap: null,
        hidden: true,
      },
    ]);
  });

  it('names the retired sections from the current side', () => {
    const named = describeRetiredSelection(DATA, 'c-north');

    expect(named?.kind).toBe('current');
    expect(named?.pairs.map((p) => [p.id, p.kind])).toEqual([['r-north', 'retired']]);
  });

  it('answers an unpaired section with no pairs and an unknown id with nothing', () => {
    expect(describeRetiredSelection(DATA, 'r-far')?.pairs).toEqual([]);
    expect(describeRetiredSelection(DATA, 'nope')).toBeNull();
  });
});

describe('the area the retired layer opens on', () => {
  const centre = (binKey: string, lat: number, lng: number) => ({ binKey, lat, lng });
  // floor(46.95 / 0.045) = 1043, floor(7.44 / 0.045) = 165; floor(47.3 / 0.045) = 1051, floor(8.9 / 0.045) = 197.
  const here = centre('1043:165', 46.95, 7.44);
  const there = centre('1051:197', 47.3, 8.9);

  it('picks the area holding the most retired lines', () => {
    const data = {
      ...DATA,
      retired: [retired('a', buf(1)), retired('b', buf(1)), retired('c', buf(3))],
    };

    expect(busiestCentre([there, here], data, decode)).toBe(here);
  });

  it('keeps the first area when no retired line falls in any of them', () => {
    expect(busiestCentre([there, here], { ...DATA, retired: [] }, decode)).toBe(there);
    expect(busiestCentre([], DATA, decode)).toBeNull();
  });
});
