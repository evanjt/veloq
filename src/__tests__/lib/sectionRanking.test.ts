import { signatureScore, sortBySignature } from '@/features/routes/lib/sectionRanking';

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
