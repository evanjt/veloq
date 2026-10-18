import { colourTokens, type ColourToken } from '@/theme';
import type { IconName } from '@/shared/ui/Icon';
import type { InsightCategory } from '../types';

/** The measure colours an insight's graphic is drawn in. */
type GraphicToken = Extract<
  ColourToken,
  'achievement' | 'fitness-ctl' | 'chart-series' | 'sport-strength'
>;

/**
 * Each category's icon, which names the category in the neutral icon colour,
 * and the colour of what its graphic measures. A category has no colour of its
 * own: a record draws in the achievement gold, fitness in the fitness line's
 * blue, strength in its sport's hue, and every comparison and trend in the
 * single chart series.
 */
export const insightCategories: Record<InsightCategory, { icon: IconName; graphic: GraphicToken }> =
  {
    section_pr: { icon: 'trophy-outline', graphic: 'achievement' },
    stale_pr: { icon: 'timer-sand', graphic: 'achievement' },
    fitness_milestone: { icon: 'flag-checkered', graphic: 'fitness-ctl' },
    period_comparison: { icon: 'calendar-week', graphic: 'chart-series' },
    hrv_trend: { icon: 'heart-pulse', graphic: 'chart-series' },
    section_trend: { icon: 'chart-line', graphic: 'chart-series' },
    route: { icon: 'map-marker-path', graphic: 'chart-series' },
    efficiency_trend: { icon: 'speedometer', graphic: 'chart-series' },
    section_changed: { icon: 'vector-polyline-edit', graphic: 'chart-series' },
    strength_progression: { icon: 'dumbbell', graphic: 'sport-strength' },
    strength_balance: { icon: 'scale-balance', graphic: 'sport-strength' },
  };

export function insightCategoryIcon(category: InsightCategory): IconName {
  return insightCategories[category].icon;
}

export function insightGraphicColour(category: InsightCategory, isDark: boolean): string {
  return colourTokens[isDark ? 'dark' : 'light'][insightCategories[category].graphic];
}
