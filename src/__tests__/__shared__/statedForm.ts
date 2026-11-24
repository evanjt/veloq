import type { WellnessData } from '@/types';

/**
 * Stands in for the engine in a render test: states each day's form, zone and
 * text the way the engine's wellness read does, so a chart under test draws
 * what it is handed. The rules themselves are pinned in the engine's own tests.
 */
const EDGES = [-30, -10, 5, 25];
const ZONES = ['highRisk', 'optimal', 'greyZone', 'fresh', 'transition'] as const;

type Day = Pick<WellnessData, 'id' | 'ctl' | 'atl'> & Partial<WellnessData>;

export function statedForm<T extends Day>(days: T[], asPercent = false): WellnessData[] {
  return days.map((day) => {
    if (day.ctl == null || day.atl == null) return day as WellnessData;
    const fitness = Math.round(day.ctl);
    const tsb = fitness - Math.round(day.atl);
    if (asPercent && fitness === 0) return day as WellnessData;
    const form = asPercent ? (tsb / fitness) * 100 : tsb;
    const at = EDGES.findIndex((edge) => form < edge);
    const rounded = Math.floor(form + 0.5) || 0;
    const sign = rounded > 0 ? '+' : '';
    return {
      ...day,
      form,
      formZone: ZONES[at === -1 ? 4 : at],
      formText: `${sign}${rounded}${asPercent ? '%' : ''}`,
      tsbText: `${tsb > 0 ? '+' : ''}${tsb || 0}`,
    } as WellnessData;
  });
}
