import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  bodyDiagram,
  colors,
  darkColors,
  insightToneColor,
  opacity,
  sequentialRamp,
} from '@/theme/colors';
import { widgetChart, widgetPalette, widgetRecord, widgetType } from '@/shared/theme/widgetTheme';

// Scenario: the widget natives render only from these resolved palettes (via the
// snapshot theme block and the generated WidgetTheme files), so every token must
// trace back to colors.ts, no widget-only hex values.

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

describe('widgetPalette', () => {
  it('carries the five form zone colours from the canonical tokens', () => {
    for (const [p, palette] of [
      [widgetPalette.light, colors],
      [widgetPalette.dark, darkColors],
    ] as const) {
      expect(p.formHighRisk).toBe(palette.formHighRisk);
      expect(p.formOptimal).toBe(palette.formOptimal);
      expect(p.formGreyZone).toBe(palette.formGreyZone);
      expect(p.formFresh).toBe(palette.formFresh);
      expect(p.formTransition).toBe(palette.formTransition);
    }
  });

  /**
   * Scenario: a value on a widget is read as text, and a measure's colour is carried by a key
   * dot beside it, so no field sets text in a zone colour. A chart line holds 3:1 on its own,
   * so none draws a casing under it.
   *
   * Expected behaviour: neither palette, nor any file generated from it, has a form zone text
   * colour or a chart casing.
   */
  it('has no form zone text colour and no chart casing, on either platform', () => {
    for (const p of [widgetPalette.light, widgetPalette.dark]) {
      const keys = Object.keys(p);
      expect(keys.filter((k) => /^form.*Text$/.test(k))).toStrictEqual([]);
      expect(keys).not.toContain('chartCasing');
    }
    const generated = [
      'widget/ios/VeloqWidget/WidgetTheme.swift',
      'widget/android/res/values/widget_theme.xml',
      'widget/android/res/values-night/widget_theme.xml',
    ];
    for (const file of generated) {
      const text = readFileSync(join(__dirname, '../..', file), 'utf8');
      expect(text).not.toMatch(/chart_?casing/i);
      expect(text).not.toMatch(/form_?\w*_?text\b/i);
    }
  });

  it('carries the fatigue purple per scheme', () => {
    expect(widgetPalette.light.fatigue).toBe(colors.fatigue);
    expect(widgetPalette.dark.fatigue).toBe(darkColors.fatigue);
  });

  it('carries one warning amber per scheme, from the canonical tokens, for a stale age line', () => {
    expect(widgetPalette.light.warning).toBe(colors.warningText);
    expect(widgetPalette.dark.warning).toBe(darkColors.warningText);
    expect(widgetPalette.light.warning).not.toBe(widgetPalette.dark.warning);
  });

  it('writes the warning amber to both platforms', () => {
    const root = join(__dirname, '../..');
    const read = (file: string) => readFileSync(join(root, file), 'utf8');
    expect(read('widget/android/res/values/widget_theme.xml')).toContain(
      `<color name="widget_warning">${widgetPalette.light.warning}</color>`
    );
    expect(read('widget/android/res/values-night/widget_theme.xml')).toContain(
      `<color name="widget_warning">${widgetPalette.dark.warning}</color>`
    );
    const swift = read('widget/ios/VeloqWidget/WidgetTheme.swift');
    expect(swift).toContain(`static let warning = Color(hex: "${widgetPalette.light.warning}")`);
    expect(swift).toContain(`static let warning = Color(hex: "${widgetPalette.dark.warning}")`);
  });

  it('carries each insight tone in the colour the app draws it in, and writes it to both platforms', () => {
    const tones = [
      'negative',
      'caution',
      'positive',
      'neutral',
      'record',
      'info',
      'opportunity',
    ] as const;
    const root = join(__dirname, '../..');
    const read = (file: string) => readFileSync(join(root, file), 'utf8');
    const light = read('widget/android/res/values/widget_theme.xml');
    const night = read('widget/android/res/values-night/widget_theme.xml');
    const swift = read('widget/ios/VeloqWidget/WidgetTheme.swift');
    for (const tone of tones) {
      const field =
        `tone${tone[0].toUpperCase()}${tone.slice(1)}` as keyof typeof widgetPalette.light;
      expect(widgetPalette.light[field]).toBe(insightToneColor(tone, false));
      expect(widgetPalette.dark[field]).toBe(insightToneColor(tone, true));
      expect(light).toContain(
        `<color name="widget_tone_${tone}">${widgetPalette.light[field]}</color>`
      );
      expect(night).toContain(
        `<color name="widget_tone_${tone}">${widgetPalette.dark[field]}</color>`
      );
      expect(swift).toContain(`static let ${field} = Color(hex: "${widgetPalette.light[field]}")`);
      expect(swift).toContain(`static let ${field} = Color(hex: "${widgetPalette.dark[field]}")`);
    }
  });

  it('has no muted text field, which would only repeat textSecondary', () => {
    for (const p of [widgetPalette.light, widgetPalette.dark]) {
      expect(Object.keys(p)).not.toContain('textMuted');
    }
    const generated = [
      'widget/ios/VeloqWidget/WidgetTheme.swift',
      'widget/android/res/values/widget_theme.xml',
      'widget/android/res/values-night/widget_theme.xml',
    ];
    for (const file of generated) {
      expect(readFileSync(join(__dirname, '../..', file), 'utf8')).not.toMatch(/text_?muted/i);
    }
  });

  it('carries the body fill and the five-step strength ramp the body diagram draws, on both platforms', () => {
    expect(widgetPalette.light.bodyFill).toBe(bodyDiagram.light.untrained);
    expect(widgetPalette.dark.bodyFill).toBe(bodyDiagram.dark.untrained);
    expect(widgetPalette.light.strengthRamp).toEqual(sequentialRamp.light);
    expect(widgetPalette.dark.strengthRamp).toEqual(sequentialRamp.dark);

    const root = join(__dirname, '../..');
    const read = (file: string) => readFileSync(join(root, file), 'utf8');
    const light = read('widget/android/res/values/widget_theme.xml');
    const night = read('widget/android/res/values-night/widget_theme.xml');
    expect(light).toContain(
      `<color name="widget_body_fill">${bodyDiagram.light.untrained}</color>`
    );
    expect(night).toContain(`<color name="widget_body_fill">${bodyDiagram.dark.untrained}</color>`);
    sequentialRamp.light.forEach((hex, i) => {
      expect(light).toContain(`<color name="widget_strength_ramp_${i + 1}">${hex}</color>`);
    });
    sequentialRamp.dark.forEach((hex, i) => {
      expect(night).toContain(`<color name="widget_strength_ramp_${i + 1}">${hex}</color>`);
    });

    const swift = read('widget/ios/VeloqWidget/WidgetTheme.swift');
    expect(swift).toContain(`static let bodyFill = Color(hex: "${bodyDiagram.light.untrained}")`);
    expect(swift).toContain(`static let bodyFill = Color(hex: "${bodyDiagram.dark.untrained}")`);
    for (const ramp of [sequentialRamp.light, sequentialRamp.dark]) {
      const line = `static let strengthRamp = [${ramp
        .map((hex) => `Color(hex: "${hex}")`)
        .join(', ')}]`;
      expect(swift.split(line)).toHaveLength(2);
    }
  });

  /**
   * Scenario: a PR dot, a record attempt dot, a trend arrow and an insight row's
   * tone dot are each the only thing on the widget that carries their meaning,
   * so WCAG 1.4.11 holds them to 3:1 against what they sit on.
   *
   * Expected behaviour: every mark field clears 3:1 on both grounds of its own
   * scheme.
   */
  it('draws every mark at 3:1 on both grounds of its scheme', () => {
    const marks = [
      'gold',
      'trendUp',
      'trendDown',
      'trendFlat',
      'toneNegative',
      'toneCaution',
      'tonePositive',
      'toneNeutral',
      'toneRecord',
      'toneInfo',
      'toneOpportunity',
    ] as const;
    const under: string[] = [];
    for (const scheme of ['light', 'dark'] as const) {
      const p = widgetPalette[scheme];
      for (const field of marks) {
        for (const ground of ['surface', 'background'] as const) {
          const ratio = contrastRatio(p[field], p[ground]);
          if (ratio < 3) under.push(`${scheme}.${field} on ${ground} ${ratio.toFixed(2)}:1`);
        }
      }
    }

    expect(under).toStrictEqual([]);
  });

  it('keeps light and dark palettes key-aligned', () => {
    expect(Object.keys(widgetPalette.light).sort()).toEqual(Object.keys(widgetPalette.dark).sort());
  });
});

// Scenario: a tinted or clear Home Screen keeps only shape and alpha, so the fatigue line's dash
// and the band alphas are what tell the marks apart there, and both platforms draw them from one
// number.
describe('widgetChart', () => {
  it('draws every alpha at a step of the opacity ladder', () => {
    const ladder = [
      opacity.tint1,
      opacity.tint2,
      opacity.tint3,
      opacity.tint4,
      opacity.dim,
      opacity.disabled,
      opacity.pressed,
    ];
    const alphas = [
      widgetChart.bandOpacity,
      ...widgetChart.bandAccentedOpacities,
      widgetChart.bandBoundary,
    ];
    expect(alphas.filter((a) => !ladder.includes(a))).toStrictEqual([]);
  });

  it('writes the fatigue dash and the band alpha to Android, where the chart bitmap draws them', () => {
    const light = readFileSync(
      join(__dirname, '../..', 'widget/android/res/values/widget_theme.xml'),
      'utf8'
    );
    const [on, off] = widgetChart.fatigueDash;
    expect(light).toContain(`<dimen name="widget_chart_fatigue_dash_on">${on}dp</dimen>`);
    expect(light).toContain(`<dimen name="widget_chart_fatigue_dash_off">${off}dp</dimen>`);
    expect(light).toContain(
      `<item name="widget_chart_band_opacity" format="float" type="dimen">${widgetChart.bandOpacity}</item>`
    );
  });
});

describe('widgetRecord', () => {
  it('draws a white foreground, with dark chrome distinct from the light', () => {
    expect(widgetRecord.foreground).toBe(colors.textOnFill);
    expect(widgetRecord.dark).not.toEqual(widgetRecord.light);
  });

  it('writes the dark chrome and accent to both platforms', () => {
    const root = join(__dirname, '../..');
    const night = readFileSync(
      join(root, 'widget/android/res/values-night/widget_theme.xml'),
      'utf8'
    );
    expect(night).toContain(
      `<color name="widget_record_grad_start">${widgetRecord.dark.gradientStart}</color>`
    );
    expect(night).toContain(
      `<color name="widget_record_grad_end">${widgetRecord.dark.gradientEnd}</color>`
    );
    expect(night).toContain(
      `<color name="widget_record_accent">${widgetRecord.dark.accent}</color>`
    );

    const swift = readFileSync(join(root, 'widget/ios/VeloqWidget/WidgetTheme.swift'), 'utf8');
    const dark = swift.match(/enum Record \{[\s\S]*?enum Dark \{([\s\S]*?)\}/)?.[1] ?? '';
    expect(dark).toContain(
      `static let gradientStart = Color(hex: "${widgetRecord.dark.gradientStart}")`
    );
    expect(dark).toContain(
      `static let gradientEnd = Color(hex: "${widgetRecord.dark.gradientEnd}")`
    );
    expect(dark).toContain(`static let accent = Color(hex: "${widgetRecord.dark.accent}")`);
  });
});

// Scenario: a widget line is drawn at one step of the type scale, and the smallest text an
// iPhone widget or an Android widget sets is the caption. A line fitted to its box may shrink
// further, to the floor, and no further.
describe('widgetType', () => {
  it('sets no step under 11 pt, and fits a line down to no less than 9', () => {
    const { floor, ...steps } = widgetType;
    for (const [step, size] of Object.entries(steps)) {
      expect([step, size >= 11]).toEqual([step, true]);
    }
    expect(floor).toBeGreaterThanOrEqual(9);
    expect(floor).toBeLessThan(widgetType.caption);
  });

  it('shrinks the record label no smaller than the floor', () => {
    expect(widgetRecord.textMin).toBeGreaterThanOrEqual(widgetType.floor);
  });
});
