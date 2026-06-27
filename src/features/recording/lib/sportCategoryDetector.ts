import type { ActivityType } from '@/types';

export type SportCategory = 'cycling' | 'running' | 'walking';

export function getSportCategory(activityType: ActivityType): SportCategory {
  const lower = activityType.toLowerCase();
  if (lower.includes('ride') || lower.includes('cycling') || lower.includes('bike'))
    return 'cycling';
  if (lower.includes('run') || lower.includes('treadmill')) return 'running';
  if (lower.includes('walk') || lower.includes('hike')) return 'walking';
  return 'cycling';
}
