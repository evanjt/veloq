/**
 * Scenario: the ride is on a followed route and the engine names the next turn ahead.
 *
 * Expected behaviour: the chip cues a turn only within 150 m of it, left or right by the sign of
 * the heading change, and a hairpin reads as a turn back. The map marks every turn on the line
 * and the one ahead of the ride, and marks nothing when no turns are held.
 */

import type { FfiNextTurn, FfiRouteTurn } from 'veloqrs';

import { turnCue } from '@/features/recording/lib/routeTurnCue';
import { routeTurnMarks } from '@/features/recording/lib/routeTurnMarks';

const next = (distanceM: number, angleDeg: number, alongM = 1_000): FfiNextTurn => ({
  alongM,
  distanceM,
  angleDeg,
});

describe('turnCue', () => {
  it('reads a left turn from a negative heading change and a right turn from a positive one', () => {
    expect(turnCue(next(50, -90))).toEqual({ kind: 'left', distanceM: 50 });
    expect(turnCue(next(50, 90))).toEqual({ kind: 'right', distanceM: 50 });
  });

  it('shows the cue up to 150 m and nothing beyond it', () => {
    expect(turnCue(next(150, 90))).toEqual({ kind: 'right', distanceM: 150 });
    expect(turnCue(next(150.5, 90))).toBeNull();
    expect(turnCue(next(400, 90))).toBeNull();
  });

  it('reads a heading change over 150 degrees as a turn back, and 150 exactly as a plain turn', () => {
    expect(turnCue(next(50, 170))).toEqual({ kind: 'back', distanceM: 50 });
    expect(turnCue(next(50, -170))).toEqual({ kind: 'back', distanceM: 50 });
    expect(turnCue(next(50, 150))).toEqual({ kind: 'right', distanceM: 50 });
    expect(turnCue(next(50, -150))).toEqual({ kind: 'left', distanceM: 50 });
  });

  it('is nothing with no next turn', () => {
    expect(turnCue(null)).toBeNull();
    expect(turnCue(undefined)).toBeNull();
  });
});

describe('routeTurnMarks', () => {
  const turn = (alongM: number, lat: number, lng: number): FfiRouteTurn => ({
    alongM,
    angleDeg: 90,
    lat,
    lng,
  });
  const TURNS = [turn(200, 46.9, 7.4), turn(700, 46.91, 7.41), turn(900, 46.92, 7.42)];

  it('holds one point per turn at its position, the one ahead of the ride marked next', () => {
    const marks = routeTurnMarks(TURNS, 700);

    expect(marks.features).toHaveLength(3);
    expect(marks.features.map((f) => (f.geometry as GeoJSON.Point).coordinates)).toEqual([
      [7.4, 46.9],
      [7.41, 46.91],
      [7.42, 46.92],
    ]);
    expect(marks.features.map((f) => f.properties?.next)).toEqual([false, true, false]);
  });

  it('marks no turn next when none is ahead', () => {
    const marks = routeTurnMarks(TURNS, null);

    expect(marks.features.map((f) => f.properties?.next)).toEqual([false, false, false]);
  });

  it('is an empty collection when no turns are held', () => {
    expect(routeTurnMarks([], null)).toEqual({ type: 'FeatureCollection', features: [] });
    expect(routeTurnMarks([], 700)).toEqual({ type: 'FeatureCollection', features: [] });
  });
});
