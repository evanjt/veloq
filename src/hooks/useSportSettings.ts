import { useQuery } from '@tanstack/react-query';
import { intervalsApi } from '@/api';
import type { SportSettings, Zone } from '@/types';

export function useSportSettings() {
  return useQuery<SportSettings[]>({
    queryKey: ['sportSettings'],
    queryFn: () => intervalsApi.getSportSettings(),
    staleTime: 1000 * 60 * 30, // 30 minutes - settings don't change often
  });
}

// Get settings for a specific sport type
export function getSettingsForSport(
  settings: SportSettings[] | undefined,
  sportType: string
): SportSettings | undefined {
  if (!settings) return undefined;
  return settings.find(s => s.types.includes(sportType));
}

// Default power zone colors (intervals.icu style)
export const POWER_ZONE_COLORS = [
  '#808080', // Z1 - Recovery (Grey)
  '#0099FF', // Z2 - Endurance (Blue)
  '#00CC00', // Z3 - Tempo (Green)
  '#FFCC00', // Z4 - Threshold (Yellow)
  '#FF6600', // Z5 - VO2max (Orange)
  '#FF0000', // Z6 - Anaerobic (Red)
  '#990099', // Z7 - Neuromuscular (Purple)
];

// Default HR zone colors
export const HR_ZONE_COLORS = [
  '#808080', // Z1 - Recovery
  '#0099FF', // Z2 - Endurance
  '#00CC00', // Z3 - Tempo
  '#FFCC00', // Z4 - Threshold
  '#FF0000', // Z5 - Max
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
