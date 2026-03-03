import {
  fromUnixSeconds,
  castDirection,
  toDirectionStats,
  convertActivityPortions,
} from '@/lib/utils/ffiConversions';

describe('fromUnixSeconds', () => {
  it('converts a valid timestamp to the correct Date', () => {
    // 2026-01-15T00:00:00Z
    const date = fromUnixSeconds(1768435200);
    expect(date).not.toBeNull();
    expect(date!.getUTCFullYear()).toBe(2026);
    expect(date!.getUTCMonth()).toBe(0); // January
    expect(date!.getUTCDate()).toBe(15);
  });

  it('returns null for null', () => {
    expect(fromUnixSeconds(null)).toBeNull();
  });

  it('handles bigint input from FFI', () => {
    const date = fromUnixSeconds(BigInt(1768435200));
    expect(date).not.toBeNull();
    expect(date!.getUTCFullYear()).toBe(2026);
  });

  it('handles negative timestamp (before epoch)', () => {
    const date = fromUnixSeconds(-86400);
    expect(date).not.toBeNull();
    // Dec 31, 1969
    expect(date!.getUTCFullYear()).toBe(1969);
    expect(date!.getUTCMonth()).toBe(11);
    expect(date!.getUTCDate()).toBe(31);
  });
});

describe('castDirection', () => {
  it('returns "reverse" for "reverse"', () => {
    expect(castDirection('reverse')).toBe('reverse');
  });

  it('returns "same" for null', () => {
    expect(castDirection(null)).toBe('same');
  });
});

describe('toDirectionStats', () => {
  it('converts valid input with Date conversion', () => {
    const result = toDirectionStats({ avgTime: 120.5, lastActivity: 1768435200, count: 5 });
    expect(result).not.toBeNull();
    expect(result!.avgTime).toBe(120.5);
    expect(result!.lastActivity).toBeInstanceOf(Date);
    expect(result!.lastActivity!.getUTCFullYear()).toBe(2026);
    expect(result!.count).toBe(5);
  });

  it('returns null for null input', () => {
    expect(toDirectionStats(null)).toBeNull();
  });

  it('handles avgTime null', () => {
    const result = toDirectionStats({ avgTime: null, lastActivity: 1768435200, count: 3 });
    expect(result).not.toBeNull();
    expect(result!.avgTime).toBeNull();
  });
});

describe('convertActivityPortions', () => {
  it('casts directions correctly', () => {
    const portions = [
      { id: '1', direction: 'same', distance: 100 },
      { id: '2', direction: 'reverse', distance: 200 },
    ];
    const result = convertActivityPortions(portions);
    expect(result).toHaveLength(2);
    expect(result![0].direction).toBe('same');
    expect(result![1].direction).toBe('reverse');
  });

  it('returns undefined for null', () => {
    expect(convertActivityPortions(null)).toBeUndefined();
  });

  it('preserves all non-direction fields', () => {
    const portions = [{ direction: 'same', id: 'a1', distance: 500, startIndex: 0, endIndex: 10 }];
    const result = convertActivityPortions(portions);
    expect(result![0].id).toBe('a1');
    expect(result![0].distance).toBe(500);
    expect(result![0].startIndex).toBe(0);
    expect(result![0].endIndex).toBe(10);
  });
});
