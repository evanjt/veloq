import { createTimelineLayout } from '../timelineLayout';

const DAY_MS = 24 * 60 * 60 * 1000;
const YEAR_MS = 365.25 * DAY_MS;

// Five whole older years sit before the recent twelve months.
const maxDate = new Date(2026, 9, 5, 12, 0, 0);
const minDate = new Date(maxDate.getTime() - 6 * YEAR_MS);
const layout = () => createTimelineLayout({ minDate, maxDate, trackWidth: 320 });

describe('createTimelineLayout', () => {
  it('gives the recent twelve months the right half of the track', () => {
    expect(layout().recentShare).toBe(0.5);
  });

  it('maps the track ends and midpoint to dates', () => {
    const { positionToDate } = layout();
    expect(positionToDate(1).getTime()).toBe(maxDate.getTime());
    expect(positionToDate(0.5).getTime()).toBeCloseTo(maxDate.getTime() - YEAR_MS, -1);
    expect(positionToDate(0).getTime()).toBeCloseTo(minDate.getTime(), -1);
  });

  it('maps dates back to positions', () => {
    const { dateToPosition } = layout();
    expect(dateToPosition(maxDate)).toBe(1);
    expect(dateToPosition(new Date(maxDate.getTime() - YEAR_MS))).toBeCloseTo(0.5, 10);
    expect(dateToPosition(new Date(minDate.getTime() - 10 * YEAR_MS))).toBe(0);
  });

  it('lays out year, quarter and now ticks', () => {
    const { snapPoints, dateToPosition } = layout();
    const years = snapPoints.filter((p) => p.kind === 'year');
    const quarters = snapPoints.filter((p) => p.kind === 'quarter');
    const now = snapPoints.filter((p) => p.kind === 'now');

    expect(years.map((p) => p.date.getFullYear())).toEqual([2020, 2021, 2022, 2023, 2024, 2025]);
    expect(years.map((p) => p.position)).toEqual([
      0,
      ...[2021, 2022, 2023, 2024, 2025].map((y) =>
        expect.closeTo(dateToPosition(new Date(y, 0, 1)), 10)
      ),
    ]);
    expect(quarters.map((p) => p.position)).toEqual([0.625, 0.75, 0.875]);
    expect(quarters.every((p) => p.date.getDate() === 1)).toBe(true);
    expect(now).toHaveLength(1);
    expect(now[0].position).toBe(1);
    expect(now[0].date.getTime()).toBe(maxDate.getTime());
  });

  it('skips a year label that sits too close to the first tick, which is not on 1 January', () => {
    const years = layout().snapPoints.filter((p) => p.kind === 'year');
    const labelled = years.filter((p) => p.showLabel);
    expect(labelled.map((p) => p.date.getFullYear())).toEqual([2020, 2022, 2024, 2025]);
  });

  describe.each([1, 3, 5, 8, 12, 20, 25])('%i older years at 320 px', (olderYears) => {
    const build = () =>
      createTimelineLayout({
        minDate: new Date(maxDate.getTime() - (olderYears + 1) * YEAR_MS),
        maxDate,
        trackWidth: 320,
      });
    const labelled = () => build().snapPoints.filter((p) => p.kind === 'year' && p.showLabel);

    it('keeps visible year labels at least a label width and a gap apart', () => {
      const xs = labelled().map((p) => p.position * 320);
      const gaps = xs.slice(1).map((x, i) => x - xs.slice(0, -1).at(i)!);
      for (const gap of gaps) expect(gap).toBeGreaterThanOrEqual(32 - 1e-6);
    });

    it('labels only years divisible by one interval from 1, 2, 5 or 10', () => {
      const years = labelled().map((p) => p.date.getFullYear());
      const fits = [1, 2, 5, 10].filter((n) => years.every((y) => y % n === 0));
      expect(fits.length).toBeGreaterThan(0);
    });

    it('keeps a snap point on every year', () => {
      const l = build();
      const years = l.snapPoints.filter((p) => p.kind === 'year');
      expect(years.length).toBeGreaterThanOrEqual(olderYears);
    });
  });

  it('uses the smallest interval that clears a label, so 10 older years at 320 px label every second year', () => {
    const { snapPoints } = createTimelineLayout({
      minDate: new Date(maxDate.getTime() - 11 * YEAR_MS),
      maxDate,
      trackWidth: 320,
    });
    const years = snapPoints
      .filter((p) => p.kind === 'year' && p.showLabel)
      .map((p) => p.date.getFullYear());
    expect(years.length).toBeGreaterThan(1);
    expect(years.every((y) => y % 2 === 0)).toBe(true);
  });

  it('snaps close to a snap point and leaves other positions alone', () => {
    const { snapToNearest, snapPoints } = layout();
    const last = snapPoints.filter((p) => p.kind === 'year').at(-1)!.position;
    expect(snapToNearest(last + 0.01)).toEqual({ position: last, snapped: true });
    expect(snapToNearest(0.61)).toEqual({ position: 0.625, snapped: true });
    expect(snapToNearest(last)).toEqual({ position: last, snapped: false });
  });

  it('does not move a release midway between two ticks', () => {
    const { snapToNearest } = layout();
    expect(snapToNearest(0.5625)).toEqual({ position: 0.5625, snapped: false });
  });

  it('keeps every midpoint between neighbouring ticks free on a long history', () => {
    const { snapToNearest, snapPoints } = createTimelineLayout({
      minDate: new Date(maxDate.getTime() - 21 * YEAR_MS),
      maxDate,
      trackWidth: 320,
    });
    const positions = snapPoints.map((p) => p.position).sort((a, b) => a - b);
    for (let i = 1; i < positions.length; i++) {
      if (positions[i] - positions[i - 1] < 1e-9) continue;
      const mid = (positions[i] + positions[i - 1]) / 2;
      expect(snapToNearest(mid).snapped).toBe(false);
    }
  });

  it('gives a history under a year the whole track with no year ticks', () => {
    const shortMin = new Date(maxDate.getTime() - 90 * DAY_MS);
    const { positionToDate, dateToPosition, snapPoints, recentShare } = createTimelineLayout({
      minDate: shortMin,
      maxDate,
      trackWidth: 320,
    });
    expect(recentShare).toBe(1);
    expect(positionToDate(0).getTime()).toBe(shortMin.getTime());
    expect(positionToDate(1).getTime()).toBe(maxDate.getTime());
    const mid = positionToDate(0.5).getTime();
    expect(mid).toBeGreaterThan(shortMin.getTime());
    expect(mid).toBeLessThan(maxDate.getTime());
    expect(dateToPosition(shortMin)).toBe(0);
    expect(snapPoints.filter((p) => p.kind === 'year')).toHaveLength(0);
    expect(
      snapPoints.every((p) => p.kind === 'now' || p.date.getTime() >= shortMin.getTime())
    ).toBe(true);
  });

  it('handles a history of zero length', () => {
    const { positionToDate, dateToPosition } = createTimelineLayout({
      minDate: maxDate,
      maxDate,
      trackWidth: 320,
    });
    expect(positionToDate(0).getTime()).toBe(maxDate.getTime());
    expect(dateToPosition(maxDate)).toBe(1);
  });

  it('maps position 0 to minDate with a fractional older span', () => {
    const fracMin = new Date(maxDate.getTime() - 3.4 * YEAR_MS);
    const { positionToDate, dateToPosition, snapPoints } = createTimelineLayout({
      minDate: fracMin,
      maxDate,
      trackWidth: 320,
    });
    expect(positionToDate(0).getTime()).toBeCloseTo(fracMin.getTime(), -1);
    expect(dateToPosition(fracMin)).toBeCloseTo(0, 10);
    const years = snapPoints.filter((p) => p.kind === 'year');
    expect(years).toHaveLength(3);
    expect(years.every((p) => p.date.getTime() >= fracMin.getTime())).toBe(true);
  });

  it('is strictly increasing and clamped to the range', () => {
    for (const span of [0.25, 1, 2.5, 6]) {
      const lo = new Date(maxDate.getTime() - span * YEAR_MS);
      const { positionToDate } = createTimelineLayout({ minDate: lo, maxDate, trackWidth: 320 });
      let prev = -Infinity;
      for (let i = 0; i <= 20; i++) {
        const p = i / 20;
        const t = positionToDate(p).getTime();
        expect(t).toBeGreaterThan(prev);
        expect(t).toBeGreaterThanOrEqual(lo.getTime());
        expect(t).toBeLessThanOrEqual(maxDate.getTime());
        prev = t;
      }
    }
  });
});

describe('year ticks', () => {
  const build = (max: Date, min: Date) =>
    createTimelineLayout({ minDate: min, maxDate: max, trackWidth: 320 });
  const yearPoints = (l: ReturnType<typeof build>) => l.snapPoints.filter((p) => p.kind === 'year');
  const ymd = (d: Date) => [d.getFullYear(), d.getMonth(), d.getDate()];

  it('puts each year tick on 1 January and snapping returns that date', () => {
    const max = new Date(2026, 8, 24, 12);
    const l = build(max, new Date(2022, 5, 10));
    const tick = yearPoints(l).find((p) => p.date.getFullYear() === 2024)!;
    expect(ymd(tick.date)).toEqual([2024, 0, 1]);
    const snapped = l.snapToNearest(tick.position);
    expect(ymd(l.positionToDate(snapped.position))).toEqual([2024, 0, 1]);
    expect(l.positionToDate(snapped.position).getHours()).toBe(0);
  });

  it('gives the same date for a label on maxDates a day apart', () => {
    const min = new Date(2022, 5, 10);
    const a = yearPoints(build(new Date(2026, 8, 24, 12), min));
    const b = yearPoints(build(new Date(2026, 8, 25, 12), min));
    const date = (pts: typeof a) => pts.find((p) => p.date.getFullYear() === 2025)!.date.getTime();
    expect(date(a)).toBe(date(b));
  });

  it('keeps position 0 on minDate and drops a 1 January inside the last year', () => {
    const max = new Date(2026, 8, 24, 12);
    const min = new Date(2022, 5, 10);
    const l = build(max, min);
    const years = yearPoints(l);
    expect(years[0].position).toBe(0);
    expect(years[0].date.getTime()).toBe(min.getTime());
    expect(years.map((p) => p.date.getFullYear())).toEqual([2022, 2023, 2024, 2025]);
    expect(years.every((p) => p.date.getTime() <= max.getTime() - YEAR_MS)).toBe(true);
    for (const p of years) {
      expect(l.positionToDate(p.position).getTime()).toBe(p.date.getTime());
    }
  });
});

describe('recent share by length of history', () => {
  const withOlderYears = (older: number) =>
    createTimelineLayout({
      minDate: new Date(maxDate.getTime() - (older + 1) * YEAR_MS),
      maxDate,
      trackWidth: 320,
    });

  it.each([
    [5, 0.5],
    [5.01, 0.35],
    [10, 0.35],
    [10.01, 0.25],
    [20, 0.25],
    [20.01, 0.2],
    [25, 0.2],
  ])('gives %s older years a recent share of %s', (older, share) => {
    const l = withOlderYears(older);
    expect(l.recentShare).toBeCloseTo(share, 10);
    expect(l.dateToPosition(new Date(maxDate.getTime() - YEAR_MS))).toBeCloseTo(1 - share, 10);
    const quarters = l.snapPoints.filter((p) => p.kind === 'quarter').map((p) => p.position);
    expect(quarters).toEqual([1, 2, 3].map((i) => expect.closeTo(1 - share + (i / 4) * share, 10)));
  });

  it.each([5, 5.01, 10.01, 20.01, 25])('round-trips dates across %s older years', (older) => {
    const l = withOlderYears(older);
    const minTime = maxDate.getTime() - (older + 1) * YEAR_MS;
    for (let i = 0; i <= 40; i++) {
      const t = minTime + ((maxDate.getTime() - minTime) * i) / 40;
      expect(l.positionToDate(l.dateToPosition(new Date(t))).getTime()).toBeCloseTo(t, -1);
    }
  });
});

describe('quarter labels by recent share', () => {
  const build = (older: number) =>
    createTimelineLayout({
      minDate: new Date(maxDate.getTime() - (older + 1) * YEAR_MS),
      maxDate,
      trackWidth: 320,
    });

  it.each([
    [3, 0.5, 3],
    [5, 0.5, 3],
    [8, 0.35, 1],
    [15, 0.25, 1],
    [25, 0.2, 1],
  ])('labels the right quarters with %s older years (share %s)', (older, share, labelled) => {
    const l = build(older);
    expect(l.recentShare).toBe(share);
    const quarters = l.snapPoints.filter((p) => p.kind === 'quarter');
    expect(quarters).toHaveLength(3);
    expect(quarters.filter((p) => p.showLabel)).toHaveLength(labelled);
    if (labelled === 1) expect(quarters[1].showLabel).toBe(true);
  });

  it.each([0.5, 3, 5, 5.5, 8, 12, 15, 25])(
    'no two visible labels overlap with %s older years at 320 px',
    (older) => {
      const xs = build(older)
        .snapPoints.filter((p) => p.showLabel)
        .map((p) => p.position * 320)
        .sort((a, b) => a - b);
      for (let i = 1; i < xs.length; i++) expect(xs[i] - xs[i - 1]).toBeGreaterThanOrEqual(28);
    }
  );
});
