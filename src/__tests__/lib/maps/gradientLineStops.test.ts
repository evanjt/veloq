/**
 * Scenario: line-gradient places each stop by the fraction of the drawn line's
 * length, while the grade stream is sampled by time.
 * Expected behaviour: a stop sits at its sample's fraction of the distance, so
 * a slow climb and a fast descent each colour their own half of the line.
 */

import { buildGradientLineStops, gradientToColor } from '@/features/maps/lib/gradientLineColor';

/** Progress values out of the alternating `[progress, colour, ...]` stops. */
const progressOf = (stops: (string | number)[]) => stops.filter((_, i) => i % 2 === 0) as number[];

/** Ten samples climbing over the first 100 m, then two descending the next 100 m. */
const climb = { grade: [...Array(10).fill(8), -8, -8], distance: [] as number[] };
climb.distance = [...Array.from({ length: 10 }, (_, i) => i * 10), 150, 200];

describe('buildGradientLineStops', () => {
  it('places each stop at its fraction of the distance', () => {
    const stops = buildGradientLineStops(climb.grade, climb.distance);
    expect(stops).not.toBeNull();
    const progress = progressOf(stops!);
    expect(progress).toEqual([0, 0.05, 0.1, 0.15, 0.2, 0.25, 0.3, 0.35, 0.4, 0.45, 0.75, 1]);
  });

  it('puts the top of the climb at the halfway length, not at its index fraction', () => {
    const grade = [...Array(3600).fill(6), ...Array(720).fill(-6)];
    const distance = [
      ...Array.from({ length: 3600 }, (_, i) => (i * 10_000) / 3600),
      ...Array.from({ length: 720 }, (_, i) => 10_000 + ((i + 1) * 10_000) / 720),
    ];
    const stops = buildGradientLineStops(grade, distance)!;
    const lastClimbStop = stops.lastIndexOf(gradientToColor(6)) - 1;
    expect(stops[lastClimbStop] as number).toBeCloseTo(0.5, 1);
    expect(stops[lastClimbStop] as number).toBeLessThan(0.51);
  });

  it('keeps progress strictly increasing through a stop with the recorder running', () => {
    const grade = [2, 2, 2, 2, 2, 4];
    const distance = [0, 50, 50, 50, 50, 100];
    const progress = progressOf(buildGradientLineStops(grade, distance)!);
    expect(progress).toEqual([0, 0.5, 1]);
  });

  it('measures from where the distance stream starts', () => {
    const progress = progressOf(buildGradientLineStops([1, 2, 3], [500, 550, 700])!);
    expect(progress).toEqual([0, 0.25, 1]);
  });

  it('falls back to index when distance is missing, short, decreasing or flat', () => {
    const grade = [1, 2, 3, 4, 5];
    const byIndex = [0, 0.25, 0.5, 0.75, 1];
    for (const distance of [undefined, [0, 10, 20], [0, 10, 5, 20, 30], [0, 0, 0, 0, 0]]) {
      expect(progressOf(buildGradientLineStops(grade, distance)!)).toEqual(byIndex);
    }
  });

  it('ends at 1 when the stride skips the last sample', () => {
    const grade = Array(250).fill(3);
    const distance = Array.from({ length: 250 }, (_, i) => i * 4);
    const progress = progressOf(buildGradientLineStops(grade, distance)!);
    expect(progress[progress.length - 1]).toBe(1);
    expect(progress.every((p, i) => i === 0 || p > progress[i - 1])).toBe(true);
  });

  it('draws nothing for fewer than two samples', () => {
    expect(buildGradientLineStops(undefined, undefined)).toBeNull();
    expect(buildGradientLineStops([3], [0])).toBeNull();
  });

  it('rebases fractions to the samples that have a position', () => {
    const grade = [5, 5, 1, 2, 3, 4, 9];
    const distance = [0, 100, 200, 300, 400, 500, 600];
    const hasPosition = [false, false, true, true, true, true, false];
    const progress = progressOf(buildGradientLineStops(grade, distance, 100, hasPosition)!);
    expect(progress[0]).toBe(0);
    expect(progress[1]).toBeCloseTo(1 / 3);
    expect(progress[progress.length - 1]).toBe(1);
  });

  it('ignores a mask whose length does not match the streams', () => {
    const withMask = buildGradientLineStops([1, 2, 3], [0, 50, 100], 100, [true]);
    expect(withMask).toEqual(buildGradientLineStops([1, 2, 3], [0, 50, 100]));
  });
});
