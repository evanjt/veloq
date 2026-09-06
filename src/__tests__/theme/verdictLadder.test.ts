/**
 * Scenario: four palettes each answered good, caution and bad, and one verdict
 * drew from three of them. A section trend was a form zone in the routes
 * banner, a semantic colour in the insight card and an insight icon tone in
 * the generators, so the same judgement arrived in three different greens.
 *
 * Expected behaviour: one ladder owns the verdict rungs. Every rung is drawn
 * as text or an icon, so it clears 4.5:1 against the surface it sits on, the
 * polarity rungs run monotone from negative to positive with a stated
 * separation rather than one chosen by eye, and the neutral rung is grey
 * enough that it can never be read as a polarity.
 */

import { verdict, verdictColor, brand } from '@/theme';
import { getTrendStyle } from '@/features/routes/components/TodayBanner';
import { getTrendColor } from '@/features/insights/components/content/SectionTrendContent';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('expo-router', () => ({ router: { push: jest.fn() }, useFocusEffect: jest.fn() }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const LIGHT_SURFACE = '#FFFFFF';
const DARK_SURFACE = '#18181B';

/** The floor the polarity rungs hold between adjacent steps, in both themes. */
const MIN_ADJACENT_CONTRAST = 1.4;

/** Text and icon minimum from WCAG 2.1 AA. */
const MIN_SURFACE_CONTRAST = 4.5;

const POLARITY = ['negative', 'caution', 'positive'] as const;

function channels(hex: string): [number, number, number] {
  const clean = hex.replace('#', '');
  return [0, 2, 4].map((i) => parseInt(clean.substring(i, i + 2), 16) / 255) as [
    number,
    number,
    number,
  ];
}

function relativeLuminance(hex: string): number {
  const [r, g, b] = channels(hex).map((v) =>
    v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4)
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [relativeLuminance(a), relativeLuminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** Distance from grey: the spread between the widest and narrowest channel. */
function chroma(hex: string): number {
  const ch = channels(hex);
  return Math.max(...ch) - Math.min(...ch);
}

describe('verdict ladder', () => {
  it('has one token per rung, in both themes', () => {
    expect(Object.keys(verdict).sort()).toEqual([
      'caution',
      'negative',
      'neutral',
      'positive',
      'record',
    ]);
    for (const rung of Object.values(verdict)) {
      expect(rung.light).toMatch(/^#[0-9A-F]{6}$/i);
      expect(rung.dark).toMatch(/^#[0-9A-F]{6}$/i);
    }
  });

  it.each(['light', 'dark'] as const)('runs monotone from negative to positive in %s', (theme) => {
    const luminances = POLARITY.map((rung) => relativeLuminance(verdict[rung][theme]));
    expect(luminances).toEqual([...luminances].sort((a, b) => a - b));
  });

  it.each(['light', 'dark'] as const)('holds the stated separation per step in %s', (theme) => {
    for (let i = 1; i < POLARITY.length; i += 1) {
      const step = contrastRatio(verdict[POLARITY[i - 1]][theme], verdict[POLARITY[i]][theme]);
      expect(step).toBeGreaterThanOrEqual(MIN_ADJACENT_CONTRAST);
    }
  });

  it.each([
    ['light', LIGHT_SURFACE],
    ['dark', DARK_SURFACE],
  ] as const)('reads as text on the %s surface', (theme, surface) => {
    for (const rung of Object.values(verdict)) {
      expect(contrastRatio(rung[theme], surface)).toBeGreaterThanOrEqual(MIN_SURFACE_CONTRAST);
    }
  });

  it('keeps the neutral rung grey and every polarity rung coloured', () => {
    expect(chroma(verdict.neutral.light)).toBeLessThanOrEqual(0.05);
    expect(chroma(verdict.neutral.dark)).toBeLessThanOrEqual(0.05);
    for (const rung of POLARITY) {
      expect(chroma(verdict[rung].light)).toBeGreaterThanOrEqual(0.3);
      expect(chroma(verdict[rung].dark)).toBeGreaterThanOrEqual(0.3);
    }
  });

  it('keeps the record rung off the polarity chain', () => {
    const chain = POLARITY.flatMap((rung) => [verdict[rung].light, verdict[rung].dark]);
    expect(chain).not.toContain(verdict.record.light);
    expect(chain).not.toContain(verdict.record.dark);
    expect(verdict.record.dark).toBe(brand.goldLight);
  });

  it('cannot use the light-mode brand gold, which is why the record rung darkens it', () => {
    expect(contrastRatio(brand.goldDark, LIGHT_SURFACE)).toBeLessThan(MIN_SURFACE_CONTRAST);
  });
});

describe('verdictColor', () => {
  it('resolves every rung to the theme it was asked for', () => {
    for (const [name, rung] of Object.entries(verdict)) {
      expect(verdictColor(name as keyof typeof verdict, false)).toBe(rung.light);
      expect(verdictColor(name as keyof typeof verdict, true)).toBe(rung.dark);
    }
  });
});

describe('the two sites that drew a verdict from another palette', () => {
  it("colours the routes banner's section trend from the ladder", () => {
    expect(getTrendStyle('improving', false)).toEqual({ color: verdict.positive.light });
    expect(getTrendStyle('declining', false)).toEqual({ color: verdict.negative.light });
    expect(getTrendStyle('stable', false)).toEqual({ color: verdict.neutral.light });
    expect(getTrendStyle('improving', true)).toEqual({ color: verdict.positive.dark });
  });

  it('gives the banner an unknown trend the neutral rung rather than a polarity', () => {
    expect(getTrendStyle('', false)).toEqual({ color: verdict.neutral.light });
    expect(getTrendStyle('sideways', true)).toEqual({ color: verdict.neutral.dark });
  });

  it('colours the section trend insight from the ladder, faster being positive', () => {
    expect(getTrendColor(1, false)).toBe(verdict.positive.light);
    expect(getTrendColor(-1, false)).toBe(verdict.negative.light);
    expect(getTrendColor(0, false)).toBe(verdict.neutral.light);
    expect(getTrendColor(1, true)).toBe(verdict.positive.dark);
    expect(getTrendColor(-1, true)).toBe(verdict.negative.dark);
  });

  it('gives a missing section trend the neutral rung', () => {
    expect(getTrendColor(undefined, false)).toBe(verdict.neutral.light);
    expect(getTrendColor(undefined, true)).toBe(verdict.neutral.dark);
  });
});
