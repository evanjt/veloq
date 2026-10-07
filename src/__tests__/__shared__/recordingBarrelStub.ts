const COMPONENTS = new Set([
  'ActivityStatsCard',
  'BatteryOptimisationNudge',
  'ControlBar',
  'DataFieldGrid',
  'ConnectedDataFieldGrid',
  'FieldPickerModal',
  'GrantAccessButton',
  'IndoorDisplay',
  'ManualEntry',
  'PendingUploadsCard',
  'PermissionUpgradeBanner',
  'RecordFAB',
  'RecordingCloseButton',
  'RecordingGate',
  'RecordingMap',
  'RecordingReturnPill',
  'RecordingTitle',
  'ReviewMapHero',
  'RouteOverlayPicker',
  'RpeSlider',
  'SaveErrorBanner',
  'StatusSlot',
  'TimerHeader',
  'UnlockTrack',
  'WorkoutGuide',
]);

const SOURCES: Record<string, string> = {
  StrengthSession: 'components/StrengthFollow',
  styles: 'RecordingScreen.styles',
  getTimeOfDayKey: 'hooks/useActivityNameGeneration',
  useRecordingPreferences: 'stores/RecordingPreferencesStore',
  initializeRecordingPreferences: 'stores/RecordingPreferencesStore',
  useRecordingStore: 'stores/RecordingStore',
  useRecordingLiveStore: 'stores/RecordingLiveStore',
  useUploadPermissionStore: 'stores/UploadPermissionStore',
  initializeUploadPermission: 'stores/UploadPermissionStore',
  defaultEntrySport: 'lib/recordEntry',
  entrySportChips: 'lib/recordEntry',
  recordingEntryHref: 'lib/recordEntry',
  ACTIVITY_CATEGORIES: 'lib/recordingModes',
  getRecordingMode: 'lib/recordingModes',
  screenRecordingMode: 'lib/recordingModes',
  recordingActions: 'lib/recordingActions',
  installRecordingSession: 'lib/recordingSession',
  resumeStoppedRecording: 'lib/resumeStoppedRecording',
  sessionReturnRoute: 'lib/sessionReturnRoute',
  promptInterruptedRecording: 'lib/interruptedRecording',
  armSystemRecordingPath: 'lib/armCountdown',
  canStartAfterScopeWarning: 'lib/armCountdown',
  adoptOwnerlessRecordings: 'lib/storage/recordingLibrary',
  getVisibleRecording: 'lib/storage/recordingLibrary',
  recordingFitExists: 'lib/storage/recordingLibrary',
  adoptOwnerlessRecordingBackup: 'lib/storage/recordingBackup',
  settleOwnerlessAdoptions: 'lib/storage/recordingBackup',
  readRecordingTrack: 'lib/storage/recordingTrack',
  resumeHeldRecordingForAthlete: 'lib/holdRecordingOnSignOut',
  holdRecordingOnSignOut: 'lib/holdRecordingOnSignOut',
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
