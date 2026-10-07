import { buildZoneDistribution } from '@/features/fitness/hooks/useZoneDistribution';

const defaultName = (type: 'power' | 'hr', zone: number) =>
  zone <= 7 ? `${type}-${zone}` : undefined;

describe('buildZoneDistribution', () => {
  it('keeps every heart rate zone the engine totals, so time above the fifth is shown', () => {
    const rows =
      buildZoneDistribution([100, 100, 100, 100, 100, 400, 100], 'hr', [], defaultName) ?? [];

    expect(rows).toHaveLength(7);
    expect(rows.map((r) => r.seconds)).toEqual([100, 100, 100, 100, 100, 400, 100]);
    expect(rows.map((r) => r.percentage)).toEqual([10, 10, 10, 10, 10, 40, 10]);
    expect(rows[4].name).not.toBe('Max');
    expect(rows.every((r) => typeof r.color === 'string' && r.color.length > 0)).toBe(true);
  });

  it('keeps all seven power zones', () => {
    expect(
      buildZoneDistribution([1, 1, 1, 1, 1, 1, 1], 'power', [], defaultName) ?? []
    ).toHaveLength(7);
  });

  it('names a zone beyond the defaults rather than dropping it', () => {
    const rows = buildZoneDistribution([1, 1, 1, 1, 1, 1, 1, 5], 'hr', [], defaultName) ?? [];

    expect(rows).toHaveLength(8);
    expect(rows[7].seconds).toBe(5);
    expect(rows[7].zone).toBe(8);
  });

  it("names rows from the athlete's own zone names", () => {
    const rows =
      buildZoneDistribution([5, 5, 5], 'hr', ['Easy', 'Steady', 'Hard'], defaultName) ?? [];

    expect(rows.map((r) => r.name)).toEqual(['Easy', 'Steady', 'Hard']);
  });

  it('falls back to the translated default by zone id, then Z<n>, where the names run out', () => {
    const rows =
      buildZoneDistribution([1, 1, 1, 1, 1, 1, 1, 1], 'hr', ['Easy', ''], defaultName) ?? [];

    expect(rows[0].name).toBe('Easy');
    expect(rows[1].name).toBe('hr-2');
    expect(rows[6].name).toBe('hr-7');
    expect(rows[7].name).toBe('Z8');
  });

  it('is undefined when there is no time in any zone', () => {
    expect(buildZoneDistribution([0, 0, 0, 0, 0, 0, 0], 'hr', [], defaultName)).toBeUndefined();
    expect(buildZoneDistribution([], 'hr', [], defaultName)).toBeUndefined();
  });
});
