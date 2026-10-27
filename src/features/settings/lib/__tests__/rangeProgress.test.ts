/**
 * Scenario: the athlete widens the activity range two years back. The
 * activities arrive at once, the request budget holds the tracks back after
 * the first hundred, and detection runs on the batch that landed.
 *
 * Expected behaviour: the panel's bar is the tracks the widened range holds
 * of the tracks it owes, whatever stage is running, so it never reads as
 * nearly done while most of the range is still to come.
 */

import { TrackStep, type LibraryCoverage, type TrackStage } from 'veloqrs';
import type { TFunction } from 'i18next';

import { rangeProgress } from '../rangeProgress';

jest.mock('veloqrs', () => require('../../../../__tests__/__shared__/veloqrsStub').withOverrides());

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

function stage(step: TrackStep, percent: number, resumesAtMs?: number): TrackStage {
  const base = { step, completed: 0, total: 0, percent, heldByUpstream: false };
  return resumesAtMs === undefined ? base : { ...base, resumesAtMs };
}

function coverage(tracksStored: number, tracksUpstream: number): LibraryCoverage {
  return { upstream: 600, fetched: 600, tracksStored, tracksUpstream };
}

const tracksLine = (completed: number, total: number) =>
  `sync.tracksDownloaded:${JSON.stringify({ completed, total })}`;

describe('the widened range progress', () => {
  it('counts tracks held of tracks owed while detection is nearly through its batch', () => {
    const progress = rangeProgress(stage(TrackStep.Analysing, 98), coverage(139, 600), false, t);

    expect(progress).toMatchObject({ done: 139, total: 600 });
    expect(progress?.detail).toBe(tracksLine(139, 600));
  });

  it('says the download is held and still counts what the range owes', () => {
    const resumesAt = new Date('2026-10-27T05:15:00Z').getTime();
    const progress = rangeProgress(
      stage(TrackStep.Held, 0, resumesAt),
      coverage(139, 600),
      false,
      t
    );

    expect(progress).toMatchObject({ done: 139, total: 600 });
    expect(progress?.label).toContain('backgroundJobs.heldByBudget');
    expect(progress?.detail).toBe(tracksLine(139, 600));
  });

  it('stays up with nothing running while tracks are owed, saying so once', () => {
    const progress = rangeProgress(null, coverage(139, 600), false, t);

    expect(progress).toEqual({ done: 139, total: 600, label: tracksLine(139, 600), detail: null });
  });

  it('follows the stage once every track is held', () => {
    const progress = rangeProgress(stage(TrackStep.Analysing, 40), coverage(600, 600), false, t);

    expect(progress).toMatchObject({ done: 40, total: 100, detail: null });
  });

  it('shows the activity download before the census has counted any tracks', () => {
    expect(rangeProgress(null, null, true, t)).toEqual({
      done: 0,
      total: 100,
      label: 'cache.fetchingActivities',
      detail: null,
    });
  });

  it('is gone when nothing runs and nothing is owed', () => {
    expect(rangeProgress(null, coverage(600, 600), false, t)).toBeNull();
    expect(rangeProgress(null, null, false, t)).toBeNull();
  });
});
