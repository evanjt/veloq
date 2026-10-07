export {
  ActivityStatsCard,
  BatteryOptimisationNudge,
  ControlBar,
  DataFieldGrid,
  ConnectedDataFieldGrid,
  FieldPickerModal,
  GrantAccessButton,
  IndoorDisplay,
  ManualEntry,
  PendingUploadsCard,
  PermissionUpgradeBanner,
  RecordFAB,
  RecordingCloseButton,
  RecordingGate,
  RecordingMap,
  RecordingReturnPill,
  RecordingTitle,
  ReviewMapHero,
  RouteOverlayPicker,
  RpeSlider,
  SaveErrorBanner,
  StatusSlot,
  StrengthSession,
  TimerHeader,
  UnlockTrack,
  WorkoutGuide,
} from './components';
export { styles } from './RecordingScreen.styles';
export { getTimeOfDayKey, useActivityNameGeneration } from './hooks/useActivityNameGeneration';
export { useActivitySummary } from './hooks/useActivitySummary';
export { useAlwaysLocationPrompt } from './hooks/useAlwaysLocationPrompt';
export { useCanRecord } from './hooks/useCanRecord';
export { useDiscardWithAnimation } from './hooks/useDiscardWithAnimation';
export { useEntryLocation } from './hooks/useEntryLocation';
export { useGpsSessionEffect } from './hooks/useGpsSessionEffect';
export { useGpsWarningClearEffect } from './hooks/useGpsWarningClearEffect';
export { useHrZoneColorEffect } from './hooks/useHrZoneColorEffect';
export { useInitRecordingEffect } from './hooks/useInitRecordingEffect';
export { useKmSplitBannerEffect } from './hooks/useKmSplitBannerEffect';
export { useLocationPermission } from './hooks/useLocationPermission';
export { usePermissionUpgrade } from './hooks/usePermissionUpgrade';
export { useRecordingHandlers } from './hooks/useRecordingHandlers';
export { useRecordingKeepAwake } from './hooks/useRecordingKeepAwake';
export { useRecordingLibrary } from './hooks/useRecordingLibrary';
export { useRecordingLock } from './hooks/useRecordingLock';
export { useRecordingMetrics } from './hooks/useRecordingMetrics';
export { useRecordingScreenColors } from './hooks/useRecordingScreenColors';
export { useRecordingScreenState } from './hooks/useRecordingScreenState';
export { useReviewSave } from './hooks/useReviewSave';
export { useStatusPulseAnimation } from './hooks/useStatusPulseAnimation';
export { useTimer } from './hooks/useTimer';
export { useUploadQueueProcessor } from './hooks/useUploadQueueProcessor';
export { armSystemRecordingPath, canStartAfterScopeWarning } from './lib/armCountdown';
export {
  holdRecordingOnSignOut,
  resumeHeldRecordingForAthlete,
} from './lib/holdRecordingOnSignOut';
export { promptInterruptedRecording } from './lib/interruptedRecording';
export { defaultEntrySport, entrySportChips, recordingEntryHref } from './lib/recordEntry';
export { recordingActions } from './lib/recordingActions';
export { ACTIVITY_CATEGORIES, getRecordingMode, screenRecordingMode } from './lib/recordingModes';
export { installRecordingSession } from './lib/recordingSession';
export { resumeStoppedRecording } from './lib/resumeStoppedRecording';
export { sessionReturnRoute } from './lib/sessionReturnRoute';
export {
  adoptOwnerlessRecordingBackup,
  settleOwnerlessAdoptions,
} from './lib/storage/recordingBackup';
export {
  adoptOwnerlessRecordings,
  getVisibleRecording,
  recordingFitExists,
} from './lib/storage/recordingLibrary';
export { readRecordingTrack } from './lib/storage/recordingTrack';
export { useRecordingLiveStore } from './stores/RecordingLiveStore';
export {
  initializeRecordingPreferences,
  useRecordingPreferences,
} from './stores/RecordingPreferencesStore';
export { useRecordingStore } from './stores/RecordingStore';
export {
  initializeUploadPermission,
  useUploadPermissionStore,
} from './stores/UploadPermissionStore';
export type { EntryGpsState } from './lib/recordEntry';
export type { GpsAccuracyMode } from './stores/RecordingPreferencesStore';
export type {
  RecordingMode,
  RecordingStatus,
  RecordingGpsPoint,
  RecordingStreams,
  RecordingLap,
  ManualActivityData,
  RecordingUploadStatus,
  RecordingKind,
  RecordingLibraryEntry,
  RecordingBackup,
  DataFieldType,
} from './types';
