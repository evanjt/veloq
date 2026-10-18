/**
 * Scenario: counts, records, changes and status words were each drawn as a
 * hand-built pill, with five radii, several tints and dark ink on fills where
 * the primary ink had turned white.
 *
 * Expected behaviour: one badge draws every tone. In both themes its ink holds
 * 4.5:1 on its fill and its fill 3:1 on every surface it sits on, a count is
 * the on-control fill with the on-fill ink, a record is the achievement fill
 * with the bright-fill ink, and the spoken label says what the text means.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { BADGE_TONES, Badge, badgePaint, verdictTone } from '@/shared/ui';
import { colors, darkColors, verdict, type VerdictRung } from '@/theme';

const AA_TEXT = 4.5;
const AA_MARK = 3;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const c = parseInt(hex.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const THEMES = [
  ['light', false, colors],
  ['dark', true, darkColors],
] as const;

const CASES = THEMES.flatMap(([name, isDark, palette]) =>
  BADGE_TONES.map((tone) => [name, tone, isDark, palette] as const)
);

describe('the badge tone table', () => {
  it('names all six tones', () => {
    expect([...BADGE_TONES].sort()).toEqual(
      ['count', 'negative', 'neutral', 'positive', 'record', 'warning'].sort()
    );
  });

  it.each(CASES)('draws %s %s ink at 4.5:1 on its fill', (_, tone, isDark) => {
    const { fill, ink } = badgePaint(tone, isDark);
    expect(contrastRatio(ink, fill)).toBeGreaterThanOrEqual(AA_TEXT);
  });

  it.each(CASES)('draws the %s %s fill at 3:1 on every surface', (_, tone, isDark, palette) => {
    const { fill } = badgePaint(tone, isDark);
    for (const surface of [
      palette.surfacePage,
      palette.surface,
      palette.surfaceRaised,
      palette.surfaceInput,
    ]) {
      expect(contrastRatio(fill, surface)).toBeGreaterThanOrEqual(AA_MARK);
    }
  });
});

describe('verdictTone', () => {
  it('draws every rung of the verdict ladder in a badge tone', () => {
    for (const rung of Object.keys(verdict) as VerdictRung[]) {
      expect(BADGE_TONES).toContain(verdictTone(rung));
    }
  });

  it('draws a caution in the warning tone and a decline in the negative one', () => {
    expect(verdictTone('caution')).toBe('warning');
    expect(verdictTone('negative')).toBe('negative');
    expect(verdictTone('positive')).toBe('positive');
  });
});

async function drawn(element: React.ReactElement, text: string) {
  const screen = await render(element);
  const label = screen.getByText(text);
  return {
    screen,
    fill: StyleSheet.flatten(screen.getByTestId('badge').props.style).backgroundColor as string,
    ink: StyleSheet.flatten(label.props.style).color as string,
    textStyle: StyleSheet.flatten(label.props.style),
  };
}

describe('Badge', () => {
  it.each(THEMES)('draws a count on control-on with the on-fill ink, %s', async (_, isDark) => {
    const palette = isDark ? darkColors : colors;
    const { fill, ink } = await drawn(
      <Badge tone="count" text="3" isDark={isDark} testID="badge" />,
      '3'
    );
    expect(fill).toBe(palette.controlOn);
    expect(ink).toBe(palette.textOnFill);
  });

  it.each(THEMES)(
    'draws a record on achievement with the bright-fill ink, %s',
    async (_, isDark) => {
      const palette = isDark ? darkColors : colors;
      const { fill, ink } = await drawn(
        <Badge tone="record" text="PR" isDark={isDark} testID="badge" />,
        'PR'
      );
      expect(fill).toBe(palette.achievement);
      expect(ink).toBe(palette.textOnBright);
    }
  );

  it('sets its text in tabular figures so a count does not shift width', async () => {
    const { textStyle } = await drawn(
      <Badge tone="count" text="12" isDark={false} testID="badge" />,
      '12'
    );
    expect(textStyle.fontVariant).toContain('tabular-nums');
  });

  it('speaks the meaning beside the text', async () => {
    const { screen } = await drawn(
      <Badge tone="count" text="3" label="3 new" isDark={false} testID="badge" />,
      '3'
    );
    expect(screen.getByTestId('badge').props.accessibilityLabel).toBe('3 new');
  });

  it('speaks its text when no meaning is given', async () => {
    const { screen } = await drawn(
      <Badge tone="neutral" text="Custom" isDark={false} testID="badge" />,
      'Custom'
    );
    expect(screen.getByTestId('badge').props.accessibilityLabel).toBe('Custom');
  });

  it('draws the small size shorter than the default', async () => {
    const md = await drawn(<Badge tone="count" text="1" isDark={false} testID="badge" />, '1');
    const mdHeight = StyleSheet.flatten(md.screen.getByTestId('badge').props.style).minHeight;
    md.screen.unmount();
    const sm = await drawn(
      <Badge tone="count" size="sm" text="1" isDark={false} testID="badge" />,
      '1'
    );
    const smHeight = StyleSheet.flatten(sm.screen.getByTestId('badge').props.style).minHeight;
    expect(mdHeight).toBe(20);
    expect(smHeight).toBe(16);
  });
});
