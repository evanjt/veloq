import type { ActivityType } from '@/types';

/** State for the selected route popup in RegionalMapView */
export interface SelectedRoute {
  id: string;
  name: string;
  activityCount: number;
  sportType: string;
  type: ActivityType;
  bestTime?: number;
}
