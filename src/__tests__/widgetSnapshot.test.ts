import {
  composeSnapshot,
  WIDGET_SNAPSHOT_SCHEMA_VERSION,
  type RawWidgetData,
} from '@/features/home/lib/widgetSnapshot';

// Scenario: the widget snapshot is consumed by native code that can't compute or
// recover from bad values, so the builder must be exhaustively null/NaN-safe and
// the impact maths must reflect today-vs-yesterday from the newest-first series.

const NOW = 1_733_360_000; // fixed unix seconds

const LABELS: Record<string, string> = {
  'metrics.form': 'Form',
  'metrics.fitness': 'Fitness',
  'metrics.fatigue': 'Fatigue',
  'metrics.hrv': 'HRV',
  'metrics.rhr': 'RHR',
  'metrics.week': 'Week',
};
const translate = (key: string) => LABELS[key] ?? key;

function makeRaw(overrides: Partial<RawWidgetData> = {}): RawWidgetData {
  return {
    sparklines: {
      // newest-first (index 0 = today)
      fitness: [72, 71, 70, 69, 68, 67, 66],
      fatigue: [80, 76, 74, 72, 70, 68, 66],
      form: [-8, -5, -4, -3, -2, -1, 0],
      hrv: [68, 65, 66, 64, 67, 63, 62],
      rhr: [48, 49, 48, 50, 49, 48, 47],
    },
    summary: {
      currentWeek: { count: 4, totalDuration: 23_400, totalDistance: 184_000, totalTss: 412 },
      prevWeek: { count: 3, totalDuration: 19_000, totalDistance: 150_000, totalTss: 349 },
    },
    latest: {
      activityId: 'i123',
      name: 'Morning Ride',
      date: NOW - 3600, // 1h ago → impact-eligible
      distance: 42_100,
      movingTime: 5660,
      trainingLoad: 62,
      sportType: 'Ride',
    },
    locale: 'en-AU',
    isMetric: true,
    nowSeconds: NOW,
    translate,
    ...overrides,
  };
}

function scanFinite(value: unknown, path = '$'): void {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error(`non-finite number at ${path}: ${value}`);
    return;
  }
  if (Array.isArray(value)) {
    value.forEach((v, i) => scanFinite(v, `${path}[${i}]`));
    return;
  }
  if (value && typeof value === 'object') {
    for (const [k, v] of Object.entries(value)) scanFinite(v, `${path}.${k}`);
  }
}

describe('composeSnapshot', () => {
  it('emits the versioned shape with resolved light/dark theme', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.schemaVersion).toBe(WIDGET_SNAPSHOT_SCHEMA_VERSION);
    expect(s.generatedAt).toBe(NOW);
    expect(s.locale).toBe('en-AU');
    expect(s.theme.light.primary).toBe('#0D9488'); // brand.tealLight
    expect(s.theme.dark.primary).toBe('#2DD4BF'); // brand.tealDark
    expect(s.theme.light.gold).toBe('#D4AF37');
  });

  it('computes today-vs-yesterday trends with a deadband', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.metrics.form).toEqual({ value: -8, trendDir: 'down', deltaVsYesterday: -3 });
    expect(s.metrics.fitness).toEqual({ value: 72, trendDir: 'up', deltaVsYesterday: 1 });
    expect(s.metrics.fatigue.trendDir).toBe('up');
  });

  it('reads flat when the change is within the deadband', () => {
    const s = composeSnapshot(
      makeRaw({
        sparklines: {
          fitness: [70, 70],
          fatigue: [60, 60],
          form: [10, 10],
          hrv: [50, 50],
          rhr: [45, 45],
        },
      })
    );
    expect(s.metrics.form.trendDir).toBe('flat');
    expect(s.metrics.fitness.trendDir).toBe('flat');
  });

  it('derives the latest activity with formatted labels', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.latest).not.toBeNull();
    expect(s.latest!.activityId).toBe('i123');
    expect(s.latest!.distanceLabel).toBe('42.1 km');
    expect(s.latest!.durationLabel).toBe('1:34:20');
    expect(typeof s.latest!.dateLabel).toBe('string');
    expect(s.latest!.tintHex).toBe('#3B82F6'); // Ride tint, resolved in JS for the widget
  });

  it('expresses the latest activity impact on the trend', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.impact).toEqual({
      formBefore: -5,
      formAfter: -8,
      ctlDelta: 1,
      atlDelta: 4,
      tssAdded: 62,
      dateLabel: expect.any(String),
    });
  });

  it('carries pre-localized labels and a composed impact line', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.display.metricLabels).toEqual({
      form: 'Form',
      fitness: 'Fitness',
      fatigue: 'Fatigue',
      hrv: 'HRV',
      rhr: 'RHR',
    });
    expect(s.display.weekLabel).toBe('Week');
    expect(s.display.impactLine).toBe('Form -5 → -8 · +62 TSS');
  });

  it('suppresses impact and impact line for a stale latest activity', () => {
    const raw = makeRaw();
    raw.latest!.date = NOW - 5 * 86400; // 5 days ago
    const s = composeSnapshot(raw);
    expect(s.impact).toBeNull();
    expect(s.display.impactLine).toBeNull();
  });

  it('reverses sparklines to oldest-first for left→right drawing', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.sparklines.form[s.sparklines.form.length - 1]).toBe(-8); // today on the right
    expect(s.sparklines.fitness[0]).toBe(66); // oldest on the left
  });

  it('computes weekly delta percent and null when last week had no load', () => {
    expect(composeSnapshot(makeRaw()).weekly.deltaPct).toBe(18);
    const noPrev = makeRaw();
    noPrev.summary!.prevWeek.totalTss = 0;
    expect(composeSnapshot(noPrev).weekly.deltaPct).toBeNull();
  });

  it('is fully null-safe with no engine data and never emits NaN/Infinity', () => {
    const s = composeSnapshot({
      sparklines: null,
      summary: null,
      latest: null,
      locale: 'en-US',
      isMetric: true,
      nowSeconds: NOW,
    });
    expect(s.metrics.form).toEqual({ value: 0, trendDir: 'flat' });
    expect(s.metrics.rampRate.value).toBe(0);
    expect(s.weekly).toMatchObject({ tss: 0, count: 0, deltaPct: null });
    expect(s.latest).toBeNull();
    expect(s.impact).toBeNull();
    scanFinite(s);
  });

  it('handles bigint FFI fields (date, totalDuration)', () => {
    const raw = makeRaw();
    // FFI delivers i64/u32 as bigint on some paths
    (raw.latest as { date: number | bigint }).date = BigInt(NOW - 3600);
    (raw.summary!.currentWeek as { totalDuration: number | bigint }).totalDuration = BigInt(23_400);
    const s = composeSnapshot(raw);
    expect(s.latest!.date).toBe(NOW - 3600);
    expect(s.weekly.durationS).toBe(23_400);
    scanFinite(s);
  });
});
