import {
  signatureScore,
  sortBySignature,
  sortSections,
} from '@/features/routes/lib/sectionRanking';

describe('signatureScore', () => {
  it('reads the pooled score, or the sport score inside a sport context', () => {
    const s = { rankScore: 0.4, sportRankScore: 0.9 };
    expect(signatureScore(s, false)).toBe(0.4);
    expect(signatureScore(s, true)).toBe(0.9);
  });

  it('falls back to the pooled score without a sport score and sorts unranked last', () => {
    expect(signatureScore({ rankScore: 0.4 }, true)).toBe(0.4);
    expect(signatureScore({}, false)).toBe(-1);
  });
});

describe('sortBySignature', () => {
  it('orders best first, ties by id, unranked at the end, without mutating the input', () => {
    const input = [
      { id: 'c', rankScore: 0.5 },
      { id: 'unranked' },
      { id: 'a', rankScore: 0.9 },
      { id: 'b', rankScore: 0.9 },
    ];
    const sorted = sortBySignature(input, false);
    expect(sorted.map((s) => s.id)).toEqual(['a', 'b', 'c', 'unranked']);
    expect(input.map((s) => s.id)).toEqual(['c', 'unranked', 'a', 'b']);
  });
});

describe('sortSections', () => {
  const list = [
    { id: 'c', rankScore: 0.5, visitCount: 9, distanceMeters: 400, name: 'Bakery Sprint' },
    { id: 'a', rankScore: 0.9, visitCount: 2, distanceMeters: 1200, name: 'Zoo Climb' },
    { id: 'b', rankScore: 0.9, visitCount: 9, distanceMeters: 400, name: 'Bakery Sprint' },
  ];

  it('orders by signature, ties by id', () => {
    expect(sortSections(list, 'signature', false).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders by visits, most first, ties by id', () => {
    expect(sortSections(list, 'visits', false).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('orders by distance, longest first, ties by id', () => {
    expect(sortSections(list, 'distance', false).map((s) => s.id)).toEqual(['a', 'b', 'c']);
  });

  it('orders by name, ties by id', () => {
    expect(sortSections(list, 'name', false).map((s) => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('leaves the nearby order alone, the engine already ranked it', () => {
    expect(sortSections(list, 'nearby', false).map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate its input', () => {
    sortSections(list, 'signature', false);
    expect(list.map((s) => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('handles an empty list and missing fields', () => {
    expect(sortSections([], 'visits', false)).toEqual([]);
    const sparse = [{ id: 'y' }, { id: 'x' }];
    expect(sortSections(sparse, 'visits', false).map((s) => s.id)).toEqual(['x', 'y']);
    expect(sortSections(sparse, 'name', false).map((s) => s.id)).toEqual(['x', 'y']);
  });
});
