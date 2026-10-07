import { createTimelineLayout } from '@/features/maps/lib/timelineLayout';

describe('snapToNearest with a right-hand limit', () => {
  const layout = createTimelineLayout({
    minDate: new Date('2022-03-10T00:00:00Z'),
    maxDate: new Date('2026-01-01T00:00:00Z'),
    trackWidth: 300,
  });
  const tick = layout.snapPoints.find((p) => p.kind === 'year' && p.position > 0)!;
  const start = tick.position - 0.02;

  it('snaps right when no limit is given', () => {
    expect(layout.snapToNearest(start - 0.01).position).toBeCloseTo(tick.position);
  });

  it('keeps the released position when the only tick in reach is right of the limit', () => {
    const result = layout.snapToNearest(start - 0.01, start);
    expect(result.position).toBeCloseTo(start - 0.01);
    expect(result.snapped).toBe(false);
  });

  it('still snaps to a tick at or left of the limit', () => {
    const result = layout.snapToNearest(tick.position - 0.01, tick.position);
    expect(result.position).toBeCloseTo(tick.position);
  });
});
