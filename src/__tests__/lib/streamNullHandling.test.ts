/**
 * Scenario: intervals.icu streams carry JSON nulls where a sensor dropped out.
 *
 * Expected behaviour: nulls are excluded from every derived figure. The global
 * isNaN and isFinite coerce null to 0, so they let nulls through a filter that
 * looks correct, and the value then reaches Math.min and the delta loop.
 */
describe('stream null handling', () => {
  const withDropout = [null, 150, 160, 168] as unknown as number[];

  it('excludes nulls from the value range, so the trace is not flattened', () => {
    const coercing = withDropout.filter((v) => !isNaN(v) && isFinite(v));
    const strict = withDropout.filter((v) => Number.isFinite(v));

    expect(Math.min(...coercing)).toBe(0);
    expect(Math.min(...strict)).toBe(150);
  });

  it('does not fabricate elevation gain across a dropout', () => {
    const elevation = [100, null, 100] as unknown as number[];

    let fabricated = 0;
    for (let i = 1; i < elevation.length; i++) {
      const delta = elevation[i] - elevation[i - 1];
      if (delta > 0 && isFinite(delta)) fabricated += delta;
    }

    let guarded = 0;
    for (let i = 1; i < elevation.length; i++) {
      if (!Number.isFinite(elevation[i]) || !Number.isFinite(elevation[i - 1])) continue;
      const delta = elevation[i] - elevation[i - 1];
      if (delta > 0) guarded += delta;
    }

    expect(fabricated).toBe(100);
    expect(guarded).toBe(0);
  });
});
