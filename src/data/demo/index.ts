// Demo data exports
export { demoAthlete } from './athlete';
export { demoActivities, getDemoActivityRoute } from './activities';
export { demoWellness } from './wellness';
export { demoPowerCurve, demoPaceCurve, demoSportSettings } from './curves';
export { demoRoutes, getRouteCoordinates, getRouteBounds, getRouteForActivity } from './routes';

// Fixture-based API exports
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
