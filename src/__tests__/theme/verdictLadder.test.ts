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

import {
  verdict,
  verdictColor,
  verdictFill,
  insightToneColor,
  insightIcon,
  brand,
  statusBadge,
} from '@/theme';
import { generateSectionTrendInsights } from '@/features/insights/generators/sectionTrend';
import type { SectionTrendData } from '@/features/insights/types';
import { getTrendStyle } from '@/features/routes/components/TodayBanner';
import { getTrendColor } from '@/features/insights/components/content/SectionTrendContent';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

const LIGHT_SURFACE = '#FFFFFF';
const DARK_SURFACE = '#18181B';

/**
 * Every surface a rung is drawn on, not the two the ladder's comment used to
 * name. A verdict is drawn on cards, and a card is `backgroundAlt` in light and
 * `surfaceCard` in dark, both further from the text tone than the two grounds
 * this test used to check, so a rung could clear the bar here and miss it on
 * every card in the app.
 */
const LIGHT_GROUNDS = [LIGHT_SURFACE, '#F8F9FA', '#F1F3F5'] as const;
const DARK_GROUNDS = [DARK_SURFACE, '#1F1F23', '#232328'] as const;

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
/**
 * A translucent fill over its ground, as the renderer composites it. A badge
 * states its fill as eight-digit hex, and measuring the label against the bare
 * hue rather than against what the eye sees is how a label under the bar reads
 * as compliant.
 */
function over(fill: string, ground: string): string {
  if (fill.length !== 9) return fill;
  const alpha = parseInt(fill.slice(7, 9), 16) / 255;
  const mix = (i: number) =>
    Math.round(
      parseInt(fill.slice(i, i + 2), 16) * alpha +
        parseInt(ground.slice(i, i + 2), 16) * (1 - alpha)
    )
      .toString(16)
      .toUpperCase()
      .padStart(2, '0');
  return `#${mix(1)}${mix(3)}${mix(5)}`;
}

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
    ['light', LIGHT_GROUNDS],
    ['dark', DARK_GROUNDS],
  ] as const)('reads as text on every %s surface it is drawn on', (theme, grounds) => {
    for (const [name, rung] of Object.entries(verdict)) {
      for (const ground of grounds) {
        expect(`${name} on ${ground}: ${contrastRatio(rung[theme], ground).toFixed(2)}`).toBe(
          `${name} on ${ground}: ${Math.max(contrastRatio(rung[theme], ground), MIN_SURFACE_CONTRAST).toFixed(2)}`
        );
      }
    }
  });

  /**
   * Every rung, not the two that were found under the bar: the `*Strong`
   * variants share a text tone with their plain rung but not a fill, so a fix
   * to one says nothing about the other five.
   */
  it('reads every status badge label on the fill it is drawn on', () => {
    for (const [name, pair] of Object.entries(statusBadge)) {
      const settled = over(pair.bg, LIGHT_SURFACE);
      expect(`${name}: ${contrastRatio(pair.text, settled).toFixed(2)}`).toBe(
        `${name}: ${Math.max(contrastRatio(pair.text, settled), MIN_SURFACE_CONTRAST).toFixed(2)}`
      );
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

describe('the surfaces that used to answer from their own palette', () => {
  const sectionTrend = (trend: number): SectionTrendData => ({
    sectionId: `s${trend}`,
    sectionName: 'Col du Test',
    trend,
    medianRecentSecs: 600,
    bestTimeSecs: 540,
    traversalCount: 20,
  });

  it('keeps both trend directions on the summary rows', () => {
    const insights = generateSectionTrendInsights(
      [sectionTrend(1), sectionTrend(-1)],
      new Set(),
      1_700_000_000_000,
      ((key: string) => key) as never
    );

    expect(insights).toHaveLength(1);
    expect(insights[0].supportingData?.sections?.map((section) => section.trend)).toEqual([1, -1]);
  });

  it('gives a chip fill the same hue as its text, at a readable weight', () => {
    for (const rung of POLARITY) {
      for (const isDark of [false, true]) {
        const text = verdictColor(rung, isDark);
        expect(verdictFill(rung, isDark)).toBe(`${text}18`);
        expect(verdictFill(rung, isDark, true)).toBe(`${text}26`);
      }
    }
  });

  it('resolves an insight tone through the ladder, and leaves the categories alone', () => {
    for (const rung of POLARITY) {
      expect(insightToneColor(rung, false)).toBe(verdictColor(rung, false));
      expect(insightToneColor(rung, true)).toBe(verdictColor(rung, true));
    }
    expect(insightToneColor('info', false)).toBe(insightIcon.info);
    expect(insightToneColor('opportunity', true)).toBe(insightIcon.opportunity);
  });

  /**
   * The ladder answers every polarity, so the only tones this group is allowed
   * to hold are the two categories the ladder has no rung for. A member nobody
   * can reach is a hue that can be changed with no effect on any screen, which
   * is the shape that put the workout-step colours and the dead chart keys in
   * the palette for months.
   */
  it('holds no tone that nothing can reach', () => {
    const reachable = new Set(
      (['info', 'opportunity'] as const).map((tone) => insightToneColor(tone, false))
    );
    const unreachable = Object.entries(insightIcon).filter(([, hue]) => !reachable.has(hue));

    expect(unreachable.map(([name]) => name)).toStrictEqual([]);
  });

  // The pill is a solid with white text, which is the opposite of what the
  // ladder's tones are sized for, so it takes the darker tone in both themes.
  it('carries white text on the declining pill at AA', () => {
    expect(contrastRatio(verdict.negative.light, '#FFFFFF')).toBeGreaterThanOrEqual(
      MIN_SURFACE_CONTRAST
    );
  });

  it('carries white text on the improving pill at AA', () => {
    expect(contrastRatio(verdict.positive.light, '#FFFFFF')).toBeGreaterThanOrEqual(
      MIN_SURFACE_CONTRAST
    );
  });
});
