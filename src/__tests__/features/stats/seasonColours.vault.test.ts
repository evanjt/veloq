import { seasonColours } from '@/features/stats/lib/seasonColours';
import { colorWithOpacity, colourTokens, opacity } from '@/theme';

describe.each([
  ['light', false],
  ['dark', true],
] as const)('the season comparison in the %s theme', (theme, isDark) => {
  const tokens = colourTokens[theme];
  const paint = seasonColours(isDark);

  it('draws this year in the series colour and last year muted', () => {
    expect(paint.current).toBe(tokens['chart-series']);
    expect(paint.previous).toBe(tokens['chart-muted']);
  });

  it('bands the current month in the series colour at the faintest tint', () => {
    expect(paint.currentMonthBand).toBe(colorWithOpacity(tokens['chart-series'], opacity.tint1));
  });

  it('labels the current month in primary text and the others in secondary', () => {
    expect(paint.currentMonthLabel).toBe(tokens['text-primary']);
    expect(paint.monthLabel).toBe(tokens['text-secondary']);
  });
});
