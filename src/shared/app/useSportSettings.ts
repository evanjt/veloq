/**
 * Sport settings come from SQLite, not the API. Rust's sync service stores the
 * raw intervals.icu body, so zone definitions the Rust types do not model are
 * preserved exactly.
 */
import { useQuery } from '@tanstack/react-query';
import { getRouteEngine } from '@/shared/native/routeEngine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';
import type { SportSettings, Zone } from '@/types';

function readSportSettings(): SportSettings[] {
  const engine = getRouteEngine();
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

// Default power zone colors (intervals.icu website palette)
export const POWER_ZONE_COLORS = [
  '#009E80', // Z1 - Recovery (Teal)
  '#009E00', // Z2 - Endurance (Green)
  '#FFCB0E', // Z3 - Tempo (Yellow)
  '#FF7F0E', // Z4 - Threshold (Orange)
  '#DD0447', // Z5 - VO2max (Red-pink)
  '#6633CC', // Z6 - Anaerobic (Purple)
  '#1A1A1A', // Z7 - Neuromuscular (Near-black)
];

// Default HR zone colors (intervals.icu website palette)
export const HR_ZONE_COLORS = [
  '#009E80', // Z1 - Recovery (Teal)
  '#009E00', // Z2 - Endurance (Green)
  '#FFCB0E', // Z3 - Tempo (Yellow)
  '#FF7F0E', // Z4 - Threshold (Orange)
  '#DD0447', // Z5 - Max (Red-pink)
];

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
