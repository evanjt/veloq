/**
 * Scenario: a preview takes seconds on a real handset and nothing on that
 * handset can say which of the five stages they went to. The worker log is
 * `__DEV__`-gated, the queue trace dumps only on a wedge, and the installed
 * debug APK is embedded with `--dev false`.
 *
 * Expected behaviour: each stage is a duration in the FFI ring, which survives
 * a release build and is what the Developer Dashboard already draws. The names
 * are stable strings a reader can find in the table, and a stand-in, a flat
 * render and a drape are three of them rather than one average.
 */

import {
  SNAPSHOT_BOOT,
  SNAPSHOT_PHASES,
  SNAPSHOT_SAVE,
  SNAPSHOT_WAIT,
  recordSnapshotPhases,
  recordSnapshotTiles,
  recordSnapshotTiming,
  snapshotPhaseMetric,
  snapshotPageMetric,
  snapshotRenderMetric,
} from '@/features/maps/lib/snapshotTiming';
import { getFFIMetricsSummary } from '@/shared/debug/renderTimer';

describe('the names a reader looks for in the table', () => {
  it('names the four stages', () => {
    expect([SNAPSHOT_BOOT, SNAPSHOT_WAIT, SNAPSHOT_SAVE]).toEqual([
      'snapshot.boot',
      'snapshot.wait',
      'snapshot.save',
    ]);
  });

  it('tells a drape, a flat render and a stand-in apart', () => {
    expect(snapshotRenderMetric({ flat: false, standIn: false })).toBe('snapshot.render.drape');
    expect(snapshotRenderMetric({ flat: true, standIn: false })).toBe('snapshot.render.flat');
    // A stand-in is a flat image filed under the drape that was asked for, so
    // it belongs with neither.
    expect(snapshotRenderMetric({ flat: true, standIn: true })).toBe('snapshot.render.standIn');
    expect(snapshotRenderMetric({ flat: false, standIn: true })).toBe('snapshot.render.standIn');
  });

  it('separates a deliberate first paint from a failed drape fallback', () => {
    expect(snapshotRenderMetric({ flat: true, standIn: true, firstPaint: true })).toBe(
      'snapshot.render.firstPaint'
    );
    expect(snapshotRenderMetric({ flat: true, standIn: true, firstPaint: false })).toBe(
      'snapshot.render.standIn'
    );
  });

  it('tells the two page paths apart', () => {
    expect(snapshotPageMetric(true)).toBe('snapshot.page.fast');
    expect(snapshotPageMetric(false)).toBe('snapshot.page.setStyle');
  });
});

describe('what reaches the ring', () => {
  it('records the duration between the two moments', () => {
    recordSnapshotTiming('snapshot.test.plain', 1_000, 1_250);

    expect(getFFIMetricsSummary()['snapshot.test.plain']).toMatchObject({
      calls: 1,
      maxMs: 250,
    });
  });

  it('records nothing for a stage that never started', () => {
    recordSnapshotTiming('snapshot.test.unstarted', null, 1_250);

    expect(getFFIMetricsSummary()['snapshot.test.unstarted']).toBeUndefined();
  });

  it('records nothing for a start newer than its end', () => {
    // A worker reload, a requeue and a page that posts twice all produce one.
    // A negative reading pulls the mean without showing up as anything.
    recordSnapshotTiming('snapshot.test.backwards', 2_000, 1_000);

    expect(getFFIMetricsSummary()['snapshot.test.backwards']).toBeUndefined();
  });

  it('keeps a zero, which is a request assigned the moment it was queued', () => {
    recordSnapshotTiming('snapshot.test.immediate', 5_000, 5_000);

    expect(getFFIMetricsSummary()['snapshot.test.immediate']).toMatchObject({ calls: 1, maxMs: 0 });
  });
});

describe('the four stages inside one render', () => {
  it('names them in the order they happen', () => {
    expect(SNAPSHOT_PHASES.map(snapshotPhaseMetric)).toEqual([
      'snapshot.phase.style',
      'snapshot.phase.settle',
      'snapshot.phase.probe',
      'snapshot.phase.encode',
    ]);
  });

  it('records each stamp the page sent', () => {
    recordSnapshotPhases({ style: 40, settle: 3_200, probe: 180, encode: 120 });

    expect(getFFIMetricsSummary()['snapshot.phase.settle']).toMatchObject({
      calls: 1,
      maxMs: 3_200,
    });
    expect(getFFIMetricsSummary()['snapshot.phase.encode']).toMatchObject({ calls: 1, maxMs: 120 });
  });

  it('records nothing for a stage the render never reached', () => {
    const before = getFFIMetricsSummary()['snapshot.phase.probe']?.calls ?? 0;

    recordSnapshotPhases({ style: 40 });

    expect(getFFIMetricsSummary()['snapshot.phase.probe']?.calls ?? 0).toBe(before);
  });

  it('ignores anything the page sends that is not a duration', () => {
    // The page is a string this module builds and a WebView runs, so a stage
    // can come back as a string, a NaN or a negative and a wrong reading in
    // the table is worse than a missing one.
    const before = SNAPSHOT_PHASES.map(
      (phase) => getFFIMetricsSummary()[snapshotPhaseMetric(phase)]?.calls ?? 0
    );

    recordSnapshotPhases({ style: '40', settle: NaN, probe: -1, encode: null });
    recordSnapshotPhases(undefined);
    recordSnapshotPhases('style=40');

    expect(
      SNAPSHOT_PHASES.map((phase) => getFFIMetricsSummary()[snapshotPhaseMetric(phase)]?.calls ?? 0)
    ).toEqual(before);
  });
});

describe('source counts in the metrics ring', () => {
  it('keeps zero counts and ignores malformed or unrecognised source readings', () => {
    const before = getFFIMetricsSummary()['snapshot.tiles.route']?.calls ?? 0;
    recordSnapshotTiles({
      route: { loaded: 0, total: 5 },
      terrain: { loaded: -1 },
      openmaptiles: { loaded: 1.5 },
      satellite: { loaded: '12' },
      'satellite-eox': null,
      unrelated: { loaded: 20 },
    });
    expect(getFFIMetricsSummary()['snapshot.tiles.route']).toMatchObject({
      calls: before + 1,
      maxMs: 0,
    });
    expect(getFFIMetricsSummary()['snapshot.tiles.unrelated']).toBeUndefined();
    const after = getFFIMetricsSummary();
    recordSnapshotTiles(undefined);
    recordSnapshotTiles(null);
    recordSnapshotTiles('12');
    expect(getFFIMetricsSummary()).toEqual(after);
  });

  it('adds regions once per render, so averages and maxima count whole renders', () => {
    recordSnapshotTiles({ 'satellite-eox': { loaded: 8 }, 'satellite-swisstopo-9': { loaded: 5 } });
    recordSnapshotTiles({ 'satellite-eox': { loaded: 3 } });
    expect(getFFIMetricsSummary()['snapshot.tiles.satellite']).toMatchObject({
      calls: 2,
      avgMs: 8,
      maxMs: 13,
    });
  });
});
