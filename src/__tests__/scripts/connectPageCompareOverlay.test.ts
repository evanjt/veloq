/**
 * Scenario: the passes a section page compares are carried in the address and
 * drawn together on the map slot.
 *
 * Expected behaviour: the selection round-trips through the hash as the `ids`
 * query, and a selection of one names no comparison. Each compared track is one
 * path in its colour, all fitted at one scale so a shorter track draws smaller
 * against the longer one, inside the box's margin. A track too short to draw,
 * or a set with no extent, draws nothing.
 */

import { compareOverlay, type Track } from '../../../web/connect/compare';
import { fitLines } from '../../../web/connect/fit';
import { fromRoute, opening, toRoute } from '../../../web/connect/routesList';
import { parse, write } from '../../../web/connect/router';

const BOX = { width: 1000, height: 1000, margin: 40 };

const long: Track = {
  id: 'long',
  colour: 'line-0',
  points: [
    [0, 0],
    [1, 1],
  ],
};
const short: Track = {
  id: 'short',
  colour: 'line-1',
  points: [
    [0, 0],
    [0.5, 0.5],
  ],
};

/** Every coordinate in a path's `d`, read in order. */
const numbersOf = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('compareOverlay', () => {
  it('draws each compared track in its own colour, fitted at one scale', () => {
    const paths = compareOverlay([long, short], BOX);
    expect(paths.map((p) => [p.id, p.colour])).toEqual([
      ['long', 'line-0'],
      ['short', 'line-1'],
    ]);
    const [longX, shortX] = paths.map((p) =>
      Math.max(...numbersOf(p.d).filter((_, at) => at % 2 === 0))
    );
    expect(shortX).toBeLessThan(longX);
    expect(paths[0]?.d.startsWith('M')).toBe(true);
  });

  it('keeps every drawn vertex inside the margin', () => {
    for (const path of compareOverlay([long, short], BOX)) {
      for (const n of numbersOf(path.d)) {
        expect(n).toBeGreaterThanOrEqual(BOX.margin);
        expect(n).toBeLessThanOrEqual(BOX.width - BOX.margin);
      }
    }
  });

  it('leaves out a track with fewer than two vertices', () => {
    const lone: Track = { id: 'lone', colour: 'line-2', points: [[0.2, 0.2]] };
    expect(compareOverlay([long, lone], BOX).map((p) => p.id)).toEqual(['long']);
  });

  it('draws nothing when the tracks have no extent', () => {
    const still: Track = {
      id: 'still',
      colour: 'line-0',
      points: [
        [3, 3],
        [3, 3],
      ],
    };
    expect(compareOverlay([still], BOX)).toEqual([]);
    expect(
      fitLines(
        [
          [
            [3, 3],
            [3, 3],
          ],
        ],
        BOX
      )
    ).toBeNull();
  });
});

describe('the section selection in the address', () => {
  it('round-trips the compared ids through the hash', () => {
    const state = { ...opening('sections', 's1'), ids: ['p2', 'x,y', 'p9'] };
    const hash = write(toRoute(state));
    expect(hash).toContain('ids=');
    expect(fromRoute(parse(hash))?.ids).toEqual(['p2', 'x,y', 'p9']);
  });

  it('names no comparison for a single pass, and writes no ids for it', () => {
    const hash = write(toRoute({ ...opening('sections', 's1'), ids: ['p2'] }));
    expect(hash).not.toContain('ids=');
    expect(fromRoute(parse(hash))?.ids).toEqual([]);
  });
});
