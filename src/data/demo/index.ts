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

// Crash test sections for iOS MapLibre validation testing
export {
  CRASH_TEST_SECTION_ID,
  crashTestSection,
  allCrashTestSections,
  isCrashTestSectionId,
  getCrashTestSection,
} from './crashTestSection';

// Fixture-based API exports (primary demo data source)
export {
  fixtures,
  getActivity,
  getActivities,
  getActivityMap,
  getActivityStreams,
  getWellness,
  CRASH_TEST_ACTIVITY_ID,
  type ApiActivity,
  type ApiWellness,
  type ApiActivityMap,
  type ApiActivityStreams,
  type ApiAthlete,
} from './fixtures';
