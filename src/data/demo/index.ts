// Legacy exports for backwards compatibility
export { demoAthlete } from './athlete';
export { demoActivities, getDemoActivityRoute } from './activities';
export { demoWellness } from './wellness';
export { demoPowerCurve, demoPaceCurve, demoSportSettings } from './curves';

// Route data exports
export { demoRoutes, getRouteCoordinates, getRouteBounds, getRouteForActivity } from './routes';

// Fixture-based API exports (preferred for new code)
export {
  fixtures,
  getActivity,
  getActivities,
  getActivityMap,
  getActivityStreams,
  getWellness,
  type ApiActivity,
  type ApiWellness,
  type ApiActivityMap,
  type ApiActivityStreams,
  type ApiAthlete,
} from './fixtures';
