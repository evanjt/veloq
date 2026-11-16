/**
 * Scenario: ends dragged along a track on the connect site's section and activity pages.
 *
 * Expected behaviour: an end snaps to the nearest vertex inside the allowed span, never closer
 * than the engine's minimum to the other end, the length and slope are read between the ends,
 * the padded window grows a section by a margin and stops at the track, a save names the vertex
 * indices in the ask the engine takes, and the undo targets the version live before the edit.
 */

import {
  MIN_POINTS,
  createAsk,
  expandWrite,
  indexAtDistance,
  keepsEnough,
  liveVersionOf,
  lngLatOf,
  metresBetween,
  moved,
  paddedWindow,
  pathMetres,
  revertWrite,
  slopePercent,
  snapIndex,
  trimWrite,
} from '../../../web/connect/sectionBounds';

/** A straight track north from the origin, one vertex every 0.001 degrees (about 111 m). */
const northward = (count: number) =>
  lngLatOf(Array.from({ length: count }, (_, at) => [at * 0.001, 7]));

describe('metresBetween and pathMetres', () => {
  it('measures a degree of latitude as about 111 km', () => {
    expect(metresBetween([7, 0], [7, 1])).toBeCloseTo(111_195, -2);
  });

  it('adds the legs from the first vertex to the last, both inclusive', () => {
    const path = northward(11);
    expect(pathMetres(path, { start: 2, end: 5 })).toBeCloseTo(3 * 111.195, 0);
    expect(pathMetres(path, { start: 4, end: 4 })).toBe(0);
  });
});

describe('snapIndex', () => {
  const path = northward(20);

  it('puts a point beside the track on the nearest vertex', () => {
    expect(snapIndex(path, [7.0003, 0.0072], { start: 0, end: 19 })).toBe(7);
  });

  it('looks only inside the span, so a vertex outside it is never chosen', () => {
    expect(snapIndex(path, [7, 0.0], { start: 5, end: 12 })).toBe(5);
    expect(snapIndex(path, [7, 0.019], { start: 5, end: 12 })).toBe(12);
  });

  it('answers null when the span holds no vertex', () => {
    expect(snapIndex(path, [7, 0], { start: 30, end: 40 })).toBeNull();
    expect(snapIndex([], [7, 0], { start: 0, end: 5 })).toBeNull();
  });
});

describe('moved', () => {
  const limits = { start: 0, end: 29 };

  it('moves the end handle to the snapped vertex', () => {
    expect(moved({ start: 3, end: 20 }, 'end', 17, limits)).toEqual({ start: 3, end: 17 });
  });

  it('keeps the minimum number of points between the ends', () => {
    expect(moved({ start: 3, end: 20 }, 'end', 4, limits)).toEqual({
      start: 3,
      end: 3 + MIN_POINTS - 1,
    });
    expect(moved({ start: 3, end: 20 }, 'start', 19, limits)).toEqual({
      start: 20 - (MIN_POINTS - 1),
      end: 20,
    });
  });

  it('holds an end inside the limits', () => {
    expect(moved({ start: 3, end: 20 }, 'end', 99, limits).end).toBe(29);
    expect(moved({ start: 3, end: 20 }, 'start', -4, limits).start).toBe(0);
  });

  it('leaves the span alone when the limits leave no room for the minimum', () => {
    const tight = { start: 0, end: 3 };
    expect(moved({ start: 0, end: 3 }, 'end', 2, tight)).toEqual({ start: 0, end: 3 });
    expect(moved({ start: 0, end: 3 }, 'start', 1, tight)).toEqual({ start: 0, end: 3 });
  });

  it('is judged by keepsEnough on its own result', () => {
    expect(keepsEnough({ start: 3, end: 3 + MIN_POINTS - 1 })).toBe(true);
    expect(keepsEnough({ start: 3, end: 3 + MIN_POINTS - 2 })).toBe(false);
  });
});

describe('paddedWindow', () => {
  it('adds about 500 m each side of a short section', () => {
    const path = northward(80);
    const window = paddedWindow(path, { start: 30, end: 33 });
    expect(window.start).toBeLessThan(30);
    expect(window.end).toBeGreaterThan(33);
    expect(pathMetres(path, { start: window.start, end: 30 })).toBeGreaterThanOrEqual(500);
    expect(pathMetres(path, { start: window.start + 1, end: 30 })).toBeLessThan(500);
  });

  it('stops at the ends of the track', () => {
    const path = northward(14);
    expect(paddedWindow(path, { start: 2, end: 10 })).toEqual({ start: 0, end: 13 });
  });

  it('caps the margin at 2 km however long the section is', () => {
    const path = northward(200);
    const window = paddedWindow(path, { start: 80, end: 120 });
    expect(pathMetres(path, { start: window.start, end: 80 })).toBeLessThan(2000 + 120);
  });
});

describe('slopePercent', () => {
  const path = northward(11);

  it('is the rise over the path length between the ends', () => {
    const altitude = path.map((_, at) => at * 5);
    expect(slopePercent(altitude, path, { start: 2, end: 6 })).toBeCloseTo(
      (20 / (4 * 111.195)) * 100,
      1
    );
  });

  it('is null without altitude at both ends or with the ends on one vertex', () => {
    expect(slopePercent(undefined, path, { start: 0, end: 5 })).toBeNull();
    expect(slopePercent([1, 2], path, { start: 0, end: 5 })).toBeNull();
    expect(
      slopePercent(
        path.map(() => 3),
        path,
        { start: 4, end: 4 }
      )
    ).toBeNull();
    expect(
      slopePercent([NaN, ...path.slice(1).map(() => 3)], path, { start: 0, end: 5 })
    ).toBeNull();
  });
});

describe('the writes', () => {
  it('names the snapped indices in a trim', () => {
    expect(trimWrite('s1', { start: 2, end: 17 })).toEqual({
      method: 'section.editBounds',
      params: {
        id: 's1',
        edit: 'trim',
        activityId: null,
        startIndex: 2,
        endIndex: 17,
        version: null,
      },
    });
  });

  it('names the activity and the track indices in an expand', () => {
    expect(expandWrite('s1', 'a9', { start: 40, end: 70 }).params).toMatchObject({
      edit: 'expand',
      activityId: 'a9',
      startIndex: 40,
      endIndex: 70,
    });
  });

  it('reverts to a version by number', () => {
    expect(revertWrite('s1', 3).params).toMatchObject({ edit: 'revert', version: 3 });
  });

  it('cuts a section from an activity with a trimmed name, or none when it is blank', () => {
    expect(createAsk('a1', { start: 5, end: 30 }, 'Ride', '  Hill  ')).toEqual({
      activityId: 'a1',
      startIndex: 5,
      endIndex: 30,
      sport: 'Ride',
      name: 'Hill',
    });
    expect(createAsk('a1', { start: 5, end: 30 }, 'Ride', '   ').name).toBeNull();
  });
});

describe('liveVersionOf', () => {
  const version = (n: number) => ({ version: n, createdAt: '', milestone: false, pinned: false });

  it('is the pinned version when there is one', () => {
    expect(liveVersionOf({ geometryVersions: [version(1), version(4)], pinnedVersion: 1 })).toBe(1);
  });

  it('is the newest when nothing is pinned', () => {
    expect(
      liveVersionOf({ geometryVersions: [version(1), version(4), version(2)], pinnedVersion: null })
    ).toBe(4);
  });

  it('is the first when none is stored yet, which the first edit stores for the old line', () => {
    expect(liveVersionOf({ geometryVersions: [], pinnedVersion: null })).toBe(1);
  });
});

describe('indexAtDistance', () => {
  it('picks the sample nearest a distance typed in', () => {
    expect(indexAtDistance([0, 100, 250, 400], 260)).toBe(2);
    expect(indexAtDistance([0, 100, 250, 400], -50)).toBe(0);
    expect(indexAtDistance([0, 100, 250, 400], 9_000)).toBe(3);
  });

  it('answers null for no samples', () => {
    expect(indexAtDistance([], 10)).toBeNull();
  });
});
