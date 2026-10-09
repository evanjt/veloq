/**
 * Scenario: a recording's altitude arrives one fix at a time, and the live
 * tile, the review and the uploaded file each ask for its gain and loss.
 *
 * Expected behaviour: a 3-point mean held to a 3 m margin, the engine's rule,
 * with every prefix of a recording reading what the whole rule gives it.
 */
import {
  addAltitude,
  EMPTY_ELEVATION_TRACK,
  elevationChange,
  elevationOver,
} from '@/features/recording/lib/elevationChange';

describe('elevationOver', () => {
  it.each([
    ['nothing', [], 0, 0],
    ['one reading', [100], 0, 0],
    ['two readings, which share one mean', [100, 140], 0, 0],
    ['a rise of exactly the margin', [100, 103, 106], 3, 0],
    ['a rise just under it', [100, 102.9, 105.8], 0, 0],
    ['a fall of exactly the margin', [106, 103, 100], 0, 3],
    ['sea level as a reading', [0, 4, 8], 4, 0],
    ['jitter under the margin', [100, 102, 100, 102, 100, 102], 0, 0],
  ])('reads %s', (_name, altitude, gain, loss) => {
    const totals = elevationOver(altitude);
    expect(totals.gain).toBeCloseTo(gain, 9);
    expect(totals.loss).toBeCloseTo(loss, 9);
  });

  it('skips a missing reading without resetting the level', () => {
    expect(elevationOver([100, NaN, 104, null, undefined, 108])).toEqual(
      elevationOver([100, 104, 108])
    );
    expect(elevationOver([100, 104, 108]).gain).toBe(4);
  });

  it('reads a range on its own, clamped to the stream', () => {
    const altitude = [100, 200, 204, 208];
    expect(elevationOver(altitude).gain).toBe(54);
    expect(elevationOver(altitude, 1, 3).gain).toBe(4);
    expect(elevationOver(altitude, 1, 99).gain).toBe(4);
    expect(elevationOver(altitude, 3, 1).gain).toBe(0);
  });
});

describe('addAltitude', () => {
  it('reads at every reading what the whole rule gives the readings so far', () => {
    const altitude = [100, 97, NaN, 104, 108, 103, 99, 99, 112, 0, 6, 6, 9];
    let track = EMPTY_ELEVATION_TRACK;
    altitude.forEach((reading, i) => {
      track = addAltitude(track, reading);
      expect(elevationChange(track)).toEqual(elevationOver(altitude.slice(0, i + 1)));
    });
  });

  it('leaves the track it was given as it was', () => {
    const once = addAltitude(addAltitude(EMPTY_ELEVATION_TRACK, 100), 104);
    const before = { ...once };
    addAltitude(once, 120);
    expect(once).toEqual(before);
    expect(addAltitude(once, NaN)).toBe(once);
  });
});
