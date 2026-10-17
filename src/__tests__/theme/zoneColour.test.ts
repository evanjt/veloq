/**
 * Scenario: a training zone is drawn as a bar, a chip dot or a skyline step
 * (a fill), and as the `Z3` beside it or a table row's label (text). Intervals
 * are keyed three ways on the activity screen: the chip above the table, the
 * table row's label and the band behind the chart.
 *
 * Expected behaviour: every zone's fill clears 3:1 and its text tone 4.5:1 on
 * every surface of its theme. An interval of any kind takes one colour on the
 * chip and the band, and the table row's label is the text tone of that same
 * colour.
 */

import { colors, darkColors } from '@/theme';
import { zoneColour } from '@/theme/zoneColour';
import { intervalBandToken, resolveBandColour, resolveBandTextColour } from '@/features/stats/lib';
import { intervalChips } from '@/features/activity/lib/intervalChips';
import { skylineColours } from '@/features/activity/lib/skylineColours';
import type { ActivityInterval } from '@/types';

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
      expect(contrastRatio(zoneColour(zone, true, 'fill'), ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(ZONES)('draws the zone %i fill at 3:1 or more on every light surface', (zone) => {
    for (const ground of LIGHT_SURFACES) {
      expect(contrastRatio(zoneColour(zone, false, 'fill'), ground)).toBeGreaterThanOrEqual(3);
    }
  });

  it.each(ZONES)('draws the zone %i text at 4.5:1 or more on every light surface', (zone) => {
    for (const ground of LIGHT_SURFACES) {
      expect(contrastRatio(zoneColour(zone, false, 'text'), ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it.each(ZONES)('draws the zone %i text at 4.5:1 or more on every dark surface', (zone) => {
    for (const ground of DARK_SURFACES) {
      expect(contrastRatio(zoneColour(zone, true, 'text'), ground)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it('clamps a zone outside the ladder to its ends', () => {
    expect(zoneColour(0, false, 'fill')).toBe(zoneColour(1, false, 'fill'));
    expect(zoneColour(9, true, 'fill')).toBe(zoneColour(7, true, 'fill'));
    expect(zoneColour(9, true, 'text')).toBe(zoneColour(7, true, 'text'));
  });
});

function interval(type: string, zone?: number): ActivityInterval {
  return {
    id: 1,
    type,
    start_index: 0,
    end_index: 10,
    moving_time: 60,
    elapsed_time: 60,
    zone,
  } as ActivityInterval;
}

const KINDS: [string, ActivityInterval][] = [
  ...ZONES.map((z): [string, ActivityInterval] => [`WORK Z${z}`, interval('WORK', z)]),
  ['WORK with no zone', interval('WORK')],
  ['RECOVERY', interval('RECOVERY')],
  ['REST', interval('REST')],
  ['WARMUP', interval('WARMUP')],
  ['COOLDOWN', interval('COOLDOWN')],
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

  it('keys recovery and rest with the same colour on the band and as text', () => {
    for (const isDark of [true, false]) {
      const recovery = intervalBandToken(interval('RECOVERY'), 'power');
      const rest = intervalBandToken(interval('REST'), 'power');
      expect(resolveBandColour(recovery, isDark)).toBe(resolveBandColour(rest, isDark));
      expect(resolveBandTextColour(recovery, isDark)).toBe(resolveBandTextColour(rest, isDark));
    }
  });

  it('labels a zoned work interval with the zone text tone and draws its band in the fill', () => {
    for (const isDark of [true, false]) {
      for (const zone of ZONES) {
        const token = intervalBandToken(interval('WORK', zone), 'hr');
        expect(resolveBandColour(token, isDark)).toBe(zoneColour(zone, isDark, 'fill'));
        expect(resolveBandTextColour(token, isDark)).toBe(zoneColour(zone, isDark, 'text'));
      }
    }
  });

  it.each(KINDS.flatMap(([name, i]) => [true, false].map((d) => [name, i, d] as const)))(
    '%s labels its table row at 4.5:1 on every surface (dark %s)',
    (_name, item, isDark) => {
      const text = resolveBandTextColour(intervalBandToken(item, 'power'), isDark);
      for (const ground of isDark ? DARK_SURFACES : LIGHT_SURFACES) {
        expect(contrastRatio(text, ground)).toBeGreaterThanOrEqual(4.5);
      }
    }
  );
});

describe('skylineColours', () => {
  it.each(['power', 'hr'] as const)('draws a %s zone 7 step in the dark zone fill', (zoneBasis) => {
    const [colour] = skylineColours(
      { zoneBasis, intervals: [{ zone: 7 }] } as unknown as Parameters<typeof skylineColours>[0],
      true
    );
    expect(colour).toBe(zoneColour(7, true, 'fill'));
  });
});
