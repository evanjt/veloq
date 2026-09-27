import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { colors, darkColors, brand } from '@/theme/colors';
import { widgetPalette, widgetRecord } from '@/shared/theme/widgetTheme';

// Scenario: the widget natives render only from these resolved palettes (via the
// snapshot theme block and the generated WidgetTheme files), so every token must
// trace back to colors.ts, no widget-only hex values.

describe('widgetPalette', () => {
  it('carries the five form zone colours from the canonical tokens', () => {
    for (const p of [widgetPalette.light, widgetPalette.dark]) {
      expect(p.formHighRisk).toBe(colors.formHighRisk);
      expect(p.formOptimal).toBe(colors.formOptimal);
      expect(p.formGreyZone).toBe(colors.formGreyZone);
      expect(p.formFresh).toBe(colors.formFresh);
      expect(p.formTransition).toBe(colors.formTransition);
    }
  });

  it('carries a text variant per zone, darkened on light and lightened on dark', () => {
    expect(widgetPalette.light.formHighRiskText).toBe(colors.formHighRiskText);
    expect(widgetPalette.light.formOptimalText).toBe(colors.formOptimalText);
    expect(widgetPalette.light.formGreyZoneText).toBe(colors.formGreyZoneText);
    expect(widgetPalette.light.formFreshText).toBe(colors.formFreshText);
    expect(widgetPalette.light.formTransitionText).toBe(colors.formTransitionText);

    expect(widgetPalette.dark.formHighRiskText).toBe(darkColors.formHighRiskText);
    expect(widgetPalette.dark.formOptimalText).toBe(darkColors.formOptimalText);
    expect(widgetPalette.dark.formGreyZoneText).toBe(darkColors.formGreyZoneText);
    expect(widgetPalette.dark.formFreshText).toBe(darkColors.formFreshText);
    expect(widgetPalette.dark.formTransitionText).toBe(darkColors.formTransitionText);
  });

  it('carries the fatigue purple per scheme', () => {
    expect(widgetPalette.light.fatigue).toBe(colors.fatigue);
    expect(widgetPalette.dark.fatigue).toBe(darkColors.chartFatigue);
  });

  it('keeps light and dark palettes key-aligned', () => {
    expect(Object.keys(widgetPalette.light).sort()).toEqual(Object.keys(widgetPalette.dark).sort());
  });
});

describe('widgetRecord', () => {
  it('uses brand teal chrome with white foreground', () => {
    expect(widgetRecord.gradientStart).toBe(brand.teal);
    expect(widgetRecord.gradientEnd).toBe(brand.tealLight);
    expect(widgetRecord.foreground).toBe(colors.textOnDark);
  });
});

/**
 * Scenario: the generated resources are committed, and nothing but a developer
 * running `npm run gen:widget-theme` keeps them in step with the palette. The
 * widget draws its largest form value with no zone label beside it, so a text
 * variant that reached the palette and not the XML is invisible until someone
 * reads a screenshot.
 */
describe('generated Android resources', () => {
  const ROOT = join(__dirname, '..', '..');
  const read = (dir: string) =>
    readFileSync(join(ROOT, 'widget', 'android', 'res', dir, 'widget_theme.xml'), 'utf8');

  const TEXT_RESOURCES = [
    ['widget_form_high_risk_text', 'formHighRiskText'],
    ['widget_form_optimal_text', 'formOptimalText'],
    ['widget_form_grey_zone_text', 'formGreyZoneText'],
    ['widget_form_fresh_text', 'formFreshText'],
    ['widget_form_transition_text', 'formTransitionText'],
  ] as const;

  it.each(TEXT_RESOURCES)('values/%s matches the light palette', (name, key) => {
    expect(read('values')).toContain(`<color name="${name}">${widgetPalette.light[key]}</color>`);
  });

  it.each(TEXT_RESOURCES)('values-night/%s matches the dark palette', (name, key) => {
    expect(read('values-night')).toContain(
      `<color name="${name}">${widgetPalette.dark[key]}</color>`
    );
  });

  it('keeps the fills, which the form bar draws as a ground', () => {
    expect(read('values')).toContain(
      `<color name="widget_form_grey_zone">${widgetPalette.light.formGreyZone}</color>`
    );
  });
});
