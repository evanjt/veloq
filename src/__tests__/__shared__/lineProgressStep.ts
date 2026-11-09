/**
 * Asserts that a `line-gradient` step over `line-progress` is one MapLibre's
 * `step` parser accepts. The parser ships inside the bundled renderer and no
 * MapLibre expression package is installed to load, so the rules it applies are
 * checked directly: the input, the default output and at least one stop and
 * output after it; stops in pairs; numeric stops in strictly ascending order.
 */
export function expectValidLineProgressStep(expression: unknown[]): void {
  expect(expression[0]).toBe('step');
  expect(expression[1]).toEqual(['line-progress']);
  expect(expression.length - 1).toBeGreaterThanOrEqual(4);
  expect((expression.length - 1) % 2).toBe(0);

  const stops = expression.slice(3).filter((_, i) => i % 2 === 0);
  for (const stop of stops) expect(typeof stop).toBe('number');
  for (let i = 1; i < stops.length; i++) {
    expect(stops[i] as number).toBeGreaterThan(stops[i - 1] as number);
  }
}
