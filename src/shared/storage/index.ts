export * from './gpsStorage';
export { PLATFORM_RECORD_FILE, platformRecordUri } from './platformRecord';
export { getSetting, setSetting, removeSetting } from './settingsStorage';
export { migrateSettingsToSqlite, PREFERENCE_KEYS } from './migrateSettingsToSqlite';
export {
  rememberCachedAthleteId,
  forgetCachedAthleteId,
  readCachedAthleteIdMirror,
  rememberStoredActivityCount,
  forgetStoredActivityCount,
  readStoredActivityCountMirror,
} from './cachedAthleteId';
