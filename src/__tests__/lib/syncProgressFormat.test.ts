/**
 * Tests for sync progress formatting utilities.
 *
 * Covers: formatTrackStage, the line every surface prints for the track work
 * the engine reports.
 */

import { formatTrackStage } from '@/features/maps/lib/syncProgressFormat';
import { tilePassProgress } from '@/features/routes/lib/tilePass';
import { i18n, initialiseI18n } from '@/i18n';
import { TrackStep, type TrackStage } from 'veloqrs';

import type { TFunction } from 'i18next';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

function stage(step: TrackStep, completed: number, total: number, percent: number): TrackStage {
  return { step, completed, total, percent, heldByUpstream: false };
}

function held(resumesAtMs: number, heldByUpstream: boolean): TrackStage {
  return { step: TrackStep.Held, completed: 0, total: 0, percent: 0, resumesAtMs, heldByUpstream };
}

describe('formatTrackStage', () => {
  it('shows the download with its count and its own percent', () => {
    const result = formatTrackStage(stage(TrackStep.Downloading, 5, 10, 50), t)!;
    expect(result.icon).toBe('download-outline');
    expect(result.percent).toBe(50);
    expect(result.countText).toBe('5/10');
    expect(result.indeterminate).toBe(false);
    expect(result.text).toBe(
      'cache.stageProgress:{"stage":"routesScreen.downloadingGps","percent":50}'
    );
  });

  it('shows a download that has not counted its tracks as indeterminate, with no count', () => {
    const result = formatTrackStage(stage(TrackStep.Downloading, 0, 0, 0), t)!;
    expect(result.indeterminate).toBe(true);
    expect(result.countText).toBeNull();
    expect(result.text).toBe('routesScreen.downloadingGps');
  });

  it('shows detection with its weighted percent and no count', () => {
    const result = formatTrackStage(stage(TrackStep.Analysing, 3, 8, 30), t)!;
    expect(result.icon).toBe('map-marker-path');
    expect(result.percent).toBe(30);
    expect(result.countText).toBeNull();
    expect(result.indeterminate).toBe(false);
  });

  it('shows detection before its first figure as indeterminate', () => {
    const result = formatTrackStage(stage(TrackStep.Analysing, 0, 0, 0), t)!;
    expect(result.indeterminate).toBe(true);
    expect(result.text).toBe('cache.analyzingRoutes');
  });

  it('renders nothing for a download the request budget holds back', () => {
    const resumesAt = new Date('2026-10-27T05:15:00Z').getTime();
    expect(formatTrackStage(held(resumesAt, false), t)).toBeNull();
  });

  it('renders nothing for a wait intervals.icu asked for either', () => {
    const resumesAt = new Date('2026-10-27T05:15:00Z').getTime();
    expect(formatTrackStage(held(resumesAt, true), t)).toBeNull();
  });

  it('shows the heatmap pass with no count', () => {
    const result = formatTrackStage(stage(TrackStep.DrawingHeatmap, 40, 100, 40), t)!;
    expect(result.countText).toBeNull();
    expect(result.percent).toBe(40);
    expect(result.indeterminate).toBe(false);
  });
});

/**
 * Scenario: the banner prints its line in the athlete's language.
 *
 * Expected behaviour: the line carries one figure and one typographic
 * ellipsis. The heatmap stage message used to bring its own tile figure, so
 * the banner read "Finalising heatmap... 40%... 85%".
 */
describe('the banner line in real copy', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  const percentSigns = (line: string) => line.split('%').length - 1;

  it('prints one percentage for the heatmap stage', () => {
    const line = formatTrackStage(stage(TrackStep.DrawingHeatmap, 40, 100, 40), i18n.t)!.text;
    expect(percentSigns(line)).toBe(1);
    expect(line).toBe('Finalising heatmap… 40%');
    expect(line).not.toContain('...');
  });

  it('prints the stage alone, with no figure, before any progress', () => {
    const line = formatTrackStage(stage(TrackStep.Analysing, 0, 0, 0), i18n.t)!.text;
    expect(percentSigns(line)).toBe(0);
    expect(line).toBe(i18n.t('cache.analyzingRoutes'));
  });

  it('prints the download figure once', () => {
    const line = formatTrackStage(stage(TrackStep.Downloading, 3, 12, 25), i18n.t)!.text;
    expect(percentSigns(line)).toBe(1);
    expect(line).toBe('Downloading tracks… 25%');
  });

  it('builds the tile pass row the sync follows with a stage message carrying no figure', () => {
    const row = tilePassProgress(40, 100, i18n.t);
    expect(row).toMatchObject({ status: 'computing', percent: 85 });
    expect(row.message).not.toMatch(/\d/);
  });

  it('starts the tile range at its floor and ends it at its ceiling', () => {
    expect(tilePassProgress(0, 100, i18n.t).percent).toBe(75);
    expect(tilePassProgress(100, 100, i18n.t).percent).toBe(100);
    expect(tilePassProgress(250, 100, i18n.t).percent).toBe(100);
    expect(tilePassProgress(50, 100, i18n.t, 50, 100).percent).toBe(75);
  });
});
