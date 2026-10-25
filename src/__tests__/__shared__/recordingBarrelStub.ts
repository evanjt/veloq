const COMPONENTS = new Set([
  'ActivityStatsCard',
  'BatteryOptimisationNudge',
  'ControlBar',
  'DataFieldGrid',
  'ConnectedDataFieldGrid',
  'GrantAccessButton',
  'IndoorDisplay',
  'ManualEntry',
  'OutsideAppNotice',
  'PendingUploadsCard',
  'PermissionUpgradeBanner',
  'RecordFAB',
  'RecordingCloseButton',
  'RecordingGate',
  'RecordingMap',
  'RecordingReturnPill',
  'RecordingTitle',
  'ReviewMapHero',
  'RpeSlider',
  'SaveErrorBanner',
  'StatusSlot',
  'TimerHeader',
  'UnlockTrack',
  'UploadPermissionNotice',
  'WorkoutGuide',
]);

const SOURCES: Record<string, string> = {
  StrengthSession: 'components/StrengthFollow',
  styles: 'RecordingScreen.styles',
  generatedActivityName: 'hooks/useActivityNameGeneration',
  useRecordingPreferences: 'stores/RecordingPreferencesStore',
  initialiseRecordingPreferences: 'stores/RecordingPreferencesStore',
  useClock: 'hooks/useTimer',
  useRecordingStore: 'stores/RecordingStore',
  CALORIES_ASSUMED_AGE: 'hooks/useCaloriesWeight',
  SENSOR_STALE_MS: 'stores/RecordingStore',
  useRecordingLiveStore: 'stores/RecordingLiveStore',
  useUploadPermissionStore: 'stores/UploadPermissionStore',
  initialiseUploadPermission: 'stores/UploadPermissionStore',
  useLibrarySports: 'hooks/useLibrarySports',
  defaultEntrySport: 'lib/recordEntry',
  entrySportChips: 'lib/recordEntry',
  recordingEntryHref: 'lib/recordEntry',
  getRecordingMode: 'lib/recordingModes',
  parsePairedEventId: 'lib/recordingModes',
  parseRecordingType: 'lib/recordingModes',
  screenRecordingMode: 'lib/recordingModes',
  ALL_DATA_FIELDS: 'lib/dataFields',
  fieldsForMode: 'lib/dataFields',
  MAX_DATA_FIELDS: 'lib/dataFields',
  recordingActions: 'lib/recordingActions',
  recordingStats: 'lib/recordingStats',
  uploadStatusTone: 'lib/uploadStatusTone',
  installRecordingSession: 'lib/recordingSession',
  discardReviewedRecording: 'lib/discardReview',
  resumeStoppedRecording: 'lib/resumeStoppedRecording',
  sessionReturnRoute: 'lib/sessionReturnRoute',
  shareRecordingFit: 'lib/shareRecordingFit',
  recordingBackAction: 'lib/recordingBackAction',
  promptInterruptedRecording: 'lib/interruptedRecording',
  armSystemRecordingPath: 'lib/armCountdown',
  canStartAfterScopeWarning: 'lib/armCountdown',
  adoptOwnerlessRecordings: 'lib/storage/recordingLibrary',
  getVisibleRecording: 'lib/storage/recordingLibrary',
  recordingFitExists: 'lib/storage/recordingLibrary',
  holdRecordingsOfOtherAthletes: 'lib/storage/recordingLibrary',
  startUploadQueue: 'lib/upload/startUploadQueue',
  adoptOwnerlessRecordingBackup: 'lib/storage/recordingBackup',
  settleOwnerlessAdoptions: 'lib/storage/recordingBackup',
  readRecordingTrack: 'lib/storage/recordingTrack',
  useVisibleRecording: 'hooks/useRecordingLibrary',
  resumeHeldRecordingForAthlete: 'lib/holdRecordingOnSignOut',
  holdRecordingOnSignOut: 'lib/holdRecordingOnSignOut',
  heldRideStart: 'lib/holdRecordingOnSignOut',
  nearbyRouteIds: 'lib/nearbyRoutes',
};

export function withRecordingOverrides(
  overrides: Record<string, unknown> = {}
): Record<string, unknown> {
  return new Proxy(overrides, {
    get(target, name) {
      if (typeof name !== 'string') return undefined;
      if (Object.prototype.hasOwnProperty.call(target, name)) return target[name];
      const source =
        SOURCES[name] ??
        (COMPONENTS.has(name) ? `components/${name}` : undefined) ??
        (name.startsWith('use') ? `hooks/${name}` : undefined);
      if (!source) return undefined;
      return require(`@/features/recording/${source}`)[name];
    },
  });
}
