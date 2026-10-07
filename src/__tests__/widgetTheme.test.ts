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
