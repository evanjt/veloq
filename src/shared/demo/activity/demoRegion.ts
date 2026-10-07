import { demoRoutes } from '../routes/routes';
import { getActivity } from './activities';

/** True when the id is a demo activity whose route lies in Switzerland. */
export function isSwissDemoActivity(activityId: string): boolean {
  const routeId = (getActivity(activityId) as { _routeId?: string | null } | undefined)?._routeId;
  if (!routeId) return false;
  const region = demoRoutes.find((r) => r.id === routeId)?.region;
  return region?.split(',').pop()?.trim() === 'Switzerland';
}
