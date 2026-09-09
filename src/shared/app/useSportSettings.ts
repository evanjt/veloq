/**
 * Sport settings come from SQLite, not the API. Rust's sync service stores the
 * raw intervals.icu body, so zone definitions the Rust types do not model are
 * preserved exactly.
 */
import { useQuery } from '@tanstack/react-query';
import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';
import { zoneColors } from '@/theme/colors';
import type { SportSettings, Zone } from '@/types';

function readSportSettings(): SportSettings[] {
  const engine = getEngine();
  if (!engine) return [];
  const json = engine.getSportSettings();
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? (parsed as SportSettings[]) : [];
  } catch {
    return [];
  }
}

export function useSportSettings() {
  useEngineChannel('activities', queryKeys.profile.sportSettings);

  return useQuery<SportSettings[]>({
    queryKey: queryKeys.profile.sportSettings,
    queryFn: readSportSettings,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: 1000 * 60 * 60 * 24,
  });
}

// Get settings for a specific sport type
export function getSettingsForSport(
  settings: SportSettings[] | undefined,
  sportType: string
): SportSettings | undefined {
  if (!settings) return undefined;
  return settings.find((s) => s.types.includes(sportType));
}

/**
 * The intervals.icu zone ramp, seven steps: recovery, endurance, tempo,
 * threshold, VO2max, anaerobic, neuromuscular. Power uses all of it.
 */
export const POWER_ZONE_COLORS: string[] = [
  zoneColors.zone1,
  zoneColors.zone2,
  zoneColors.zone3,
  zoneColors.zone4,
  zoneColors.zone5,
  zoneColors.zone6,
  zoneColors.zone7,
];

/** Heart rate has five zones, so it takes the ramp's first five steps. */
export const HR_ZONE_COLORS: string[] = POWER_ZONE_COLORS.slice(0, 5);

// Default zone names if not provided
export const DEFAULT_POWER_ZONES: Zone[] = [
  { id: 1, name: 'Recovery', color: POWER_ZONE_COLORS[0] },
  { id: 2, name: 'Endurance', color: POWER_ZONE_COLORS[1] },
  { id: 3, name: 'Tempo', color: POWER_ZONE_COLORS[2] },
  { id: 4, name: 'Threshold', color: POWER_ZONE_COLORS[3] },
  { id: 5, name: 'VO2max', color: POWER_ZONE_COLORS[4] },
  { id: 6, name: 'Anaerobic', color: POWER_ZONE_COLORS[5] },
  { id: 7, name: 'Neuromuscular', color: POWER_ZONE_COLORS[6] },
];

export const DEFAULT_HR_ZONES: Zone[] = [
  { id: 1, name: 'Recovery', color: HR_ZONE_COLORS[0] },
  { id: 2, name: 'Endurance', color: HR_ZONE_COLORS[1] },
  { id: 3, name: 'Tempo', color: HR_ZONE_COLORS[2] },
  { id: 4, name: 'Threshold', color: HR_ZONE_COLORS[3] },
  { id: 5, name: 'Max', color: HR_ZONE_COLORS[4] },
];

// Get zone color by index
export function getZoneColor(index: number, type: 'power' | 'hr' = 'power'): string {
  const colors = type === 'power' ? POWER_ZONE_COLORS : HR_ZONE_COLORS;
  return colors[Math.min(index, colors.length - 1)];
}
