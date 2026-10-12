/**
 * Sport settings come from SQLite, not the API. Rust's sync service stores the
 * raw intervals.icu body, so zone definitions the Rust types do not model are
 * preserved exactly.
 */
import { useQuery } from '@tanstack/react-query';
import { LOCAL_READ_QUERY } from '@/shared/query/QueryProvider';
import { getEngine } from '@/shared/native/engine';
import { useEngineChannel } from '@/shared/native/useEngineChannel';
import { queryKeys } from '@/shared/query/queryKeys';
import type { SportSettings } from '@/types';
import { TIME } from '@/shared/app/time';

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
    ...LOCAL_READ_QUERY,
    queryKey: queryKeys.profile.sportSettings,
    queryFn: readSportSettings,
    // SQLite is the source, so a sync decides freshness, not a clock.
    staleTime: Infinity,
    gcTime: TIME.DAY,
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

/** Translation keys of the default zone names, Z1 first, by zone basis. */
export const DEFAULT_ZONE_NAME_KEYS = {
  power: [
    'zoneNames.power1',
    'zoneNames.power2',
    'zoneNames.power3',
    'zoneNames.power4',
    'zoneNames.power5',
    'zoneNames.power6',
    'zoneNames.power7',
  ],
  hr: [
    'zoneNames.hr1',
    'zoneNames.hr2',
    'zoneNames.hr3',
    'zoneNames.hr4',
    'zoneNames.hr5',
    'zoneNames.hr6',
    'zoneNames.hr7',
  ],
} as const;
