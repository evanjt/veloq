import {
  composeRoutePreview,
  composeSnapshot,
  ROUTE_PREVIEW_MAX_POINTS,
  WIDGET_SNAPSHOT_SCHEMA_VERSION,
  type RawGpsPoint,
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
  'fitnessScreen.rampRate': 'Ramp',
  'metrics.ftp': 'FTP',
  'metrics.pace': 'Pace',
  'metrics.css': 'CSS',
  'formZones.highRisk': 'High Risk',
  'formZones.optimal': 'Optimal',
  'formZones.greyZone': 'Grey Zone',
  'formZones.fresh': 'Fresh',
  'formZones.transition': 'Transition',
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
      ftpTrend: { latestFtp: 251, previousFtp: 245 },
      runPaceTrend: { latestPace: 3.4, previousPace: 3.3 },
      swimPaceTrend: {},
    },
    summaryPrefs: {
      enabled: true,
      heroMetric: 'fitness',
      showSparkline: true,
      supportingMetrics: ['fitness', 'ftp', 'weekHours', 'weight'],
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
    expect(s.theme.light.formOptimal).toBe('#66BB6A'); // colors.formOptimal
    expect(s.theme.dark.formOptimal).toBe('#66BB6A');
    expect(s.theme.light.fatigue).toBe('#A855F7'); // colors.fatigue
    expect(s.theme.dark.fatigue).toBe('#C084FC'); // darkColors.chartFatigue
  });

  it('computes today-vs-yesterday trends with a deadband', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.metrics.form).toEqual({
      value: -8,
      trendDir: 'down',
      deltaVsYesterday: -3,
      zone: 'greyZone',
    });
    expect(s.metrics.fitness).toEqual({ value: 72, trendDir: 'up', deltaVsYesterday: 1 });
    expect(s.metrics.fatigue.trendDir).toBe('up');
  });

  it('assigns the form zone from the intervals.icu TSB boundaries', () => {
    const zoneFor = (tsb: number) => {
      const raw = makeRaw();
      raw.sparklines!.form = [tsb, tsb];
      return composeSnapshot(raw).metrics.form.zone;
    };
    expect(zoneFor(-35)).toBe('highRisk');
    expect(zoneFor(-20)).toBe('optimal');
    expect(zoneFor(0)).toBe('greyZone');
    expect(zoneFor(10)).toBe('fresh');
    expect(zoneFor(30)).toBe('transition');
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
      formBeforeZone: 'greyZone',
      formAfterZone: 'greyZone',
      ctlDelta: 1,
      atlDelta: 4,
      tssAdded: 62,
      dateLabel: expect.any(String),
    });
  });

  it('zones the impact before/after values independently', () => {
    const raw = makeRaw();
    raw.sparklines!.form = [-12, 8, 6, 4, 2, 0, -2];
    const s = composeSnapshot(raw);
    expect(s.impact!.formBeforeZone).toBe('fresh'); // 8
    expect(s.impact!.formAfterZone).toBe('optimal'); // -12
  });

  it('defaults latest.isPr to false and passes an engine-provided PR through', () => {
    expect(composeSnapshot(makeRaw()).latest!.isPr).toBe(false);
    const raw = makeRaw();
    raw.latest!.isPr = true;
    expect(composeSnapshot(raw).latest!.isPr).toBe(true);
  });

  it('carries pre-localized labels and a composed impact line', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.display.metricLabels).toEqual({
      form: 'Form',
      fitness: 'Fitness',
      fatigue: 'Fatigue',
      hrv: 'HRV',
      rhr: 'RHR',
      ramp: 'Ramp',
    });
    expect(s.display.weekLabel).toBe('Week');
    expect(s.display.formZone).toBe('Grey Zone');
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
    expect(s.sparklines.fatigue[0]).toBe(66);
    expect(s.sparklines.fatigue[s.sparklines.fatigue.length - 1]).toBe(80);
  });

  it('carries a zone enum per form point so natives never derive TSB boundaries', () => {
    const raw = makeRaw();
    raw.sparklines!.form = [-35, -20, 0, 10, 28]; // newest-first
    const s = composeSnapshot(raw);
    // Oldest-first, mirroring the reversed form series.
    expect(s.sparklines.formZones).toEqual([
      'transition',
      'fresh',
      'greyZone',
      'optimal',
      'highRisk',
    ]);
    expect(s.sparklines.formZones).toHaveLength(s.sparklines.form.length);
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
    expect(s.metrics.form).toEqual({ value: 0, trendDir: 'flat', zone: 'greyZone' });
    expect(s.metrics.rampRate.value).toBe(0);
    expect(s.weekly).toMatchObject({ tss: 0, count: 0, deltaPct: null });
    expect(s.latest).toBeNull();
    expect(s.impact).toBeNull();
    scanFinite(s);
  });

  it('mirrors the in-app summary card settings as a ready-to-render block', () => {
    const s = composeSnapshot(makeRaw());
    expect(s.summaryCard).not.toBeNull();
    const card = s.summaryCard!;
    expect(card.hero).toEqual({
      id: 'fitness',
      label: 'Fitness',
      value: '72',
      trendDir: 'up',
      colorKey: 'blue',
    });
    // weight is omitted (no data source in the gather path)
    expect(card.entries.map((e) => e.id)).toEqual(['fitness', 'ftp', 'weekHours']);
    expect(card.entries[1]).toEqual({
      id: 'ftp',
      label: 'FTP',
      value: '251',
      trendDir: 'up',
      colorKey: 'default',
    });
    expect(card.entries[2].value).toBe('6.5h');
    expect(card.sparkline).toBe('fitnessForm');
  });

  it('selects the hrv sparkline for an hrv hero and none when disabled', () => {
    const hrvHero = makeRaw();
    hrvHero.summaryPrefs = { ...hrvHero.summaryPrefs!, heroMetric: 'hrv' };
    expect(composeSnapshot(hrvHero).summaryCard!.sparkline).toBe('hrv');
    expect(composeSnapshot(hrvHero).summaryCard!.hero.id).toBe('hrv');

    const noSpark = makeRaw();
    noSpark.summaryPrefs = { ...noSpark.summaryPrefs!, showSparkline: false };
    expect(composeSnapshot(noSpark).summaryCard!.sparkline).toBe('none');
  });

  it('omits the summary block when disabled or prefs are missing', () => {
    const disabled = makeRaw();
    disabled.summaryPrefs = { ...disabled.summaryPrefs!, enabled: false };
    expect(composeSnapshot(disabled).summaryCard).toBeNull();
    expect(composeSnapshot(makeRaw({ summaryPrefs: null })).summaryCard).toBeNull();
  });

  it('renders "-" for summary metrics with no backing data', () => {
    const raw = makeRaw({ sparklines: null });
    raw.summaryPrefs = { ...raw.summaryPrefs!, supportingMetrics: ['hrv', 'rhr', 'css'] };
    const card = composeSnapshot(raw).summaryCard!;
    expect(card.entries.map((e) => e.value)).toEqual(['-', '-', '-']);
    expect(card.entries.map((e) => e.trendDir)).toEqual(['flat', 'flat', 'flat']);
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

describe('composeRoutePreview', () => {
  const line = (n: number): RawGpsPoint[] =>
    Array.from({ length: n }, (_, i) => ({
      latitude: 47 + i * 0.001,
      longitude: 8 + i * 0.002,
    }));

  it('normalises points into the unit box with a bounded aspect', () => {
    const preview = composeRoutePreview(line(50));
    expect(preview).not.toBeNull();
    for (const [x, y] of preview!.points) {
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(1);
      expect(y).toBeGreaterThanOrEqual(0);
      expect(y).toBeLessThanOrEqual(1);
    }
    expect(preview!.aspect).toBeGreaterThanOrEqual(0.1);
    expect(preview!.aspect).toBeLessThanOrEqual(10);
    // northward track: first point is south, so it renders at the bottom (y=1)
    expect(preview!.points[0][1]).toBe(1);
  });

  it('downsamples long tracks and keeps the final point', () => {
    const preview = composeRoutePreview(line(5000));
    expect(preview!.points.length).toBeLessThanOrEqual(ROUTE_PREVIEW_MAX_POINTS + 1);
    const last = preview!.points[preview!.points.length - 1];
    expect(last).toEqual([1, 0]);
  });

  it('returns null for missing, short, or degenerate tracks', () => {
    expect(composeRoutePreview(null)).toBeNull();
    expect(composeRoutePreview([])).toBeNull();
    expect(composeRoutePreview(line(1))).toBeNull();
    const stationary = Array.from({ length: 10 }, () => ({ latitude: 47, longitude: 8 }));
    expect(composeRoutePreview(stationary)).toBeNull();
    const junk = [
      { latitude: NaN, longitude: 8 },
      { latitude: 47, longitude: NaN },
    ];
    expect(composeRoutePreview(junk)).toBeNull();
  });
});
