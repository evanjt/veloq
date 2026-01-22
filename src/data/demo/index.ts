// Demo data exports
export { demoAthlete } from './athlete';
export { demoWellness } from './wellness';
export { demoPowerCurve, demoPaceCurve, demoSportSettings } from './curves';
export {
  demoRoutes,
  getRouteCoordinates,
  getRouteBounds,
  getRouteForActivity,
  getRouteById,
  getRouteLocation,
} from './routes';

// Fixture-based API exports (primary demo data source)
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
