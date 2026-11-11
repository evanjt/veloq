import { placeEngineTrend } from '@/features/routes/lib/scatterData';
import { fromWallClockSeconds } from '@/shared/ffi/ffiConversions';
import { atUtcOffset } from '../../__shared__/fixedOffsetDate';

const DAY = 86_400;
const START = 1_700_000_000;

const curve = [
  { time: START + 2 * DAY, value: 3, upper: 3.5, lower: 2.5 },
  { time: START + 12 * DAY, value: 4, upper: 4.5, lower: 3.5 },
];

/** Drawn points as the chart builds them: each engine date through the wall-clock owner. */
function drawnAt(wallClockSeconds: number[]): { date: Date }[] {
  return wallClockSeconds.map((seconds) => ({ date: fromWallClockSeconds(seconds)! }));
}

describe('placeEngineTrend', () => {
  it('places the engine curve on the drawn points date range, 0.02 to 0.98', () => {
    // Drawn points run day 0 to day 14: an excluded attempt widens the axis
    // beyond the curve's own span.
    const drawn = drawnAt([START + 0 * DAY, START + 14 * DAY]);
    const placed = placeEngineTrend(curve, drawn)!;
    expect(placed[0].x).toBeCloseTo(0.02 + (2 / 14) * 0.96, 12);
    expect(placed[1].x).toBeCloseTo(0.02 + (12 / 14) * 0.96, 12);
    expect(placed[1]).toMatchObject({ y: 4, upper: 4.5, lower: 3.5 });
  });

  it('spans the whole axis when the curve covers every drawn point', () => {
    const drawn = drawnAt([START + 2 * DAY, START + 12 * DAY]);
    const placed = placeEngineTrend(curve, drawn)!;
    expect(placed[0].x).toBeCloseTo(0.02, 12);
    expect(placed[1].x).toBeCloseTo(0.98, 12);
  });

  it.each([-5, 10])(
    'puts the curve and the drawn points on one scale at UTC offset %d',
    (offsetHours) => {
      atUtcOffset(offsetHours, () => {
        const drawn = drawnAt([START + 2 * DAY, START + 7 * DAY, START + 12 * DAY]);
        const placed = placeEngineTrend(curve, drawn)!;
        expect(placed[0].x).toBeCloseTo(0.02, 12);
        expect(placed[1].x).toBeCloseTo(0.98, 12);
      });
    }
  );

  it('gives no trend when the engine has no curve or nothing is drawn', () => {
    const drawn = drawnAt([START]);
    expect(placeEngineTrend(undefined, drawn)).toBeNull();
    expect(placeEngineTrend([], drawn)).toBeNull();
    expect(placeEngineTrend(curve, [])).toBeNull();
  });
});
