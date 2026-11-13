/**
 * Scenario: the form chart names each zone inside its band, and a name the
 * form line runs through cannot be read.
 *
 * Expected behaviour: a band tall enough for a label takes it at its left end
 * when the line leaves that clear, else at its right end, and a band with
 * neither end clear, or too short for a label, goes unnamed.
 */

import { zoneLabelSpots, type ZoneBandPx } from '@/features/fitness/lib/zoneLabelSpots';

const PLOT = { left: 0, right: 300 };
const BOX = { width: 60, height: 16 };
const INSET = 4;
const sizeOf = () => BOX;

/** Five stacked bands, 40px each, top to bottom. */
const BANDS: ZoneBandPx[] = [
  { zone: 'transition', top: 0, bottom: 40 },
  { zone: 'fresh', top: 40, bottom: 80 },
  { zone: 'greyZone', top: 80, bottom: 120 },
  { zone: 'optimal', top: 120, bottom: 160 },
  { zone: 'highRisk', top: 160, bottom: 200 },
];

/** A flat line at `y` across the whole plot. */
const flat = (y: number) => [
  [
    { x: 0, y },
    { x: 300, y },
  ],
];

function spotOf(spots: ReturnType<typeof zoneLabelSpots>, zone: string) {
  return spots.find((s) => s.zone === zone);
}

describe('zoneLabelSpots', () => {
  it('names every band at its left end, centred in the band, when the line runs elsewhere', () => {
    // The line sits on the border between fresh and grey, clear of every band's centre row.
    const spots = zoneLabelSpots(BANDS, flat(80), PLOT, sizeOf, INSET);

    expect(spots.map((s) => s.zone)).toEqual([
      'transition',
      'fresh',
      'greyZone',
      'optimal',
      'highRisk',
    ]);
    for (const spot of spots) {
      const band = BANDS.find((b) => b.zone === spot.zone)!;
      expect(spot.x).toBe(PLOT.left + INSET);
      expect(spot.y + BOX.height / 2).toBe((band.top + band.bottom) / 2);
    }
  });

  it('leaves a band unnamed when a flat line runs through its label row', () => {
    const spots = zoneLabelSpots(BANDS, flat(100), PLOT, sizeOf, INSET);

    expect(spotOf(spots, 'greyZone')).toBeUndefined();
    expect(spots).toHaveLength(4);
  });

  it('moves a name to the right end when the line crosses the left end only', () => {
    // Through grey's centre row on the left, then down into high risk by x = 100.
    const line = [
      [
        { x: 0, y: 100 },
        { x: 100, y: 190 },
        { x: 300, y: 190 },
      ],
    ];
    const spot = spotOf(zoneLabelSpots(BANDS, line, PLOT, sizeOf, INSET), 'greyZone');

    expect(spot).toBeDefined();
    expect(spot!.x).toBe(PLOT.right - INSET - BOX.width);
  });

  it('catches a steep segment that crosses the label row between two samples', () => {
    // Both samples sit outside optimal's label row; the segment between them crosses it.
    const line = [
      [
        { x: 20, y: 90 },
        { x: 30, y: 190 },
      ],
      [
        { x: 270, y: 90 },
        { x: 280, y: 190 },
      ],
    ];
    expect(spotOf(zoneLabelSpots(BANDS, line, PLOT, sizeOf, INSET), 'optimal')).toBeUndefined();
  });

  it('counts a lone sample inside the label box as the line', () => {
    const line = [[{ x: 30, y: 20 }], [{ x: 270, y: 20 }]];
    expect(spotOf(zoneLabelSpots(BANDS, line, PLOT, sizeOf, INSET), 'transition')).toBeUndefined();
  });

  it('names no band shorter than a label', () => {
    const bands: ZoneBandPx[] = [{ zone: 'fresh', top: 40, bottom: 52 }];
    expect(zoneLabelSpots(bands, [], PLOT, sizeOf, INSET)).toEqual([]);
  });

  it('names no band when the plot is narrower than the label', () => {
    expect(zoneLabelSpots(BANDS, [], { left: 0, right: 50 }, sizeOf, INSET)).toEqual([]);
  });

  it('names every band of a chart with no line', () => {
    expect(zoneLabelSpots(BANDS, [], PLOT, sizeOf, INSET)).toHaveLength(5);
  });
});
