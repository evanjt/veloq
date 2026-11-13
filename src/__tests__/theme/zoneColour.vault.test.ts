/**
 * Scenario: a training zone is drawn as a bar, a chip dot, a skyline step or
 * a band, and washed as a tint behind a live value. Intervals are keyed on the
 * activity screen by the chip above the table and the band behind the chart.
 *
 * Expected behaviour: every zone's fill clears 3:1 on every surface of its
 * theme. Intensity is always the zone ladder: a work interval takes its zone,
 * or the chart series colour when it has none, recovery and rest take zone 1,
 * warm-up and cool-down the muted chart colour, and any other interval has no
 * band. An interval of any kind takes one colour on the chip and the band.
 */

import { colors, colourTokens, colorWithOpacity, darkColors, opacity } from '@/theme';
import { zoneColour, zoneTint } from '@/theme/zoneColour';
import { intervalBandToken, resolveBandColour } from '@/features/stats/lib';
import { intervalChips } from '@/features/activity/lib/intervalChips';
import { skylineColours } from '@/features/activity/lib/skylineColours';
import type { ActivityInterval } from '@/types';
import { IntervalKind } from 'veloqrs';

function relativeLuminance(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const LIGHT_SURFACES = [colors.surfacePage, colors.surface, colors.surfaceRaised];
const DARK_SURFACES = [darkColors.surfacePage, darkColors.surface, darkColors.surfaceRaised];
const ZONES = [1, 2, 3, 4, 5, 6, 7];

describe('zoneColour', () => {
  it.each(ZONES)('draws the zone %i fill at 3:1 or more on every dark surface', (zone) => {
    for (const ground of DARK_SURFACES) {
      expect(contrastRatio(zoneColour(zone, true), ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(ZONES)('draws the zone %i fill at 3:1 or more on every light surface', (zone) => {
    for (const ground of LIGHT_SURFACES) {
      expect(contrastRatio(zoneColour(zone, false), ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it('clamps a zone outside the ladder to its ends', () => {
    expect(zoneColour(0, false)).toBe(zoneColour(1, false));
    expect(zoneColour(9, true)).toBe(zoneColour(7, true));
    expect(zoneTint(9, true)).toBe(zoneTint(7, true));
  });

  it('washes a zone at the faint tint in light and one step stronger in dark', () => {
    for (const zone of ZONES) {
      expect(zoneTint(zone, false)).toBe(colorWithOpacity(zoneColour(zone, false), opacity.tint2));
      expect(zoneTint(zone, true)).toBe(colorWithOpacity(zoneColour(zone, true), opacity.tint3));
    }
  });
});

function interval(kind: IntervalKind, zone?: number): ActivityInterval {
  return {
    id: 1,
    kind,
    startTime: 0,
    endTime: 60,
    startIndex: 0,
    endIndex: 10,
    movingTime: 60,
    ...(zone === undefined ? {} : { zone }),
  };
}

const KINDS: [string, ActivityInterval][] = [
  ...ZONES.map((z): [string, ActivityInterval] => [`WORK Z${z}`, interval(IntervalKind.Work, z)]),
  ['WORK with no zone', interval(IntervalKind.Work)],
  ['RECOVERY', interval(IntervalKind.Recovery)],
  ['REST', interval(IntervalKind.Rest)],
  ['WARMUP', interval(IntervalKind.Warmup)],
  ['COOLDOWN', interval(IntervalKind.Cooldown)],
];

describe('one colour per interval kind', () => {
  it.each(KINDS.flatMap(([name, i]) => [true, false].map((d) => [name, i, d] as const)))(
    '%s takes the band colour on its chip (dark %s)',
    (_name, item, isDark) => {
      for (const scale of ['power', 'hr'] as const) {
        const token = intervalBandToken(item, scale);
        const [chip] = intervalChips([item], scale, isDark);
        expect(chip.color).toBe(resolveBandColour(token, isDark));
      }
    }
  );

  it.each([false, true])(
    'draws each kind of interval from the ladder by role, dark %s',
    (isDark) => {
      const tokens = colourTokens[isDark ? 'dark' : 'light'];
      const band = (item: ActivityInterval) =>
        resolveBandColour(intervalBandToken(item, 'power'), isDark);
      for (const zone of ZONES) {
        expect(band(interval(IntervalKind.Work, zone))).toBe(zoneColour(zone, isDark));
      }
      expect(band(interval(IntervalKind.Work))).toBe(tokens['chart-series']);
      expect(band(interval(IntervalKind.Recovery))).toBe(zoneColour(1, isDark));
      expect(band(interval(IntervalKind.Rest))).toBe(zoneColour(1, isDark));
      expect(band(interval(IntervalKind.Warmup))).toBe(tokens['chart-muted']);
      expect(band(interval(IntervalKind.Cooldown))).toBe(tokens['chart-muted']);
      expect(band(interval(IntervalKind.Other))).toBeNull();
    }
  );
});

describe('skylineColours', () => {
  it.each(['power', 'hr'] as const)('draws a %s zone 7 step in the dark zone fill', (zoneBasis) => {
    const [colour] = skylineColours(
      { zoneBasis, intervals: [{ zone: 7 }] } as unknown as Parameters<typeof skylineColours>[0],
      true
    );
    expect(colour).toBe(zoneColour(7, true));
  });
});
