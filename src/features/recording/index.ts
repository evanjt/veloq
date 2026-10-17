export {
  ActivityStatsCard,
  BatteryOptimisationNudge,
  ControlBar,
  DataFieldGrid,
  ConnectedDataFieldGrid,
  GrantAccessButton,
  IndoorDisplay,
  ManualEntry,
  OutsideAppNotice,
  PendingUploadsCard,
  PermissionUpgradeBanner,
  RecordFAB,
  RecordingCloseButton,
  RecordingGate,
  RecordingMap,
  RecordingReturnPill,
  RecordingTitle,
  ReviewMapHero,
  RpeSlider,
  SaveErrorBanner,
  StatusSlot,
  StrengthSession,
  TimerHeader,
  UnlockTrack,
  UploadPermissionNotice,
  WorkoutGuide,
} from './components';
export { styles } from './RecordingScreen.styles';
export {
  generatedActivityName,
  useActivityNameGeneration,
} from './hooks/useActivityNameGeneration';
export { useActivitySummary } from './hooks/useActivitySummary';
export { useAlwaysLocationPrompt } from './hooks/useAlwaysLocationPrompt';
export { useCanRecord } from './hooks/useCanRecord';
export { useEntryLocation } from './hooks/useEntryLocation';
export { useGpsSessionEffect } from './hooks/useGpsSessionEffect';
export { useGpsWarningClearEffect } from './hooks/useGpsWarningClearEffect';
export { useHrZoneColorEffect } from './hooks/useHrZoneColorEffect';
export { useInitRecordingEffect } from './hooks/useInitRecordingEffect';
export { useKmSplitBannerEffect } from './hooks/useKmSplitBannerEffect';
export { useLapBanner } from './hooks/useLapBanner';
export { useLocationPermission } from './hooks/useLocationPermission';
export { usePermissionUpgrade } from './hooks/usePermissionUpgrade';
export { useRecordingColumnLayout } from './hooks/useRecordingColumnLayout';
export { useRecordingHandlers } from './hooks/useRecordingHandlers';
export { useRecordingKeepAwake } from './hooks/useRecordingKeepAwake';
export { useRecordingLibrary, useVisibleRecording } from './hooks/useRecordingLibrary';
export { useRecordingLock } from './hooks/useRecordingLock';
export { useRecordingMetrics } from './hooks/useRecordingMetrics';
export { useRecordingScreenColors } from './hooks/useRecordingScreenColors';
export { useRecordingScreenState } from './hooks/useRecordingScreenState';
export { useReviewDraft } from './hooks/useReviewDraft';
export { useReviewSave } from './hooks/useReviewSave';
export { useStatusPulseAnimation } from './hooks/useStatusPulseAnimation';
export { useClock, useTimer } from './hooks/useTimer';
export { useWriteAccessMissing } from './hooks/useWriteAccessMissing';
export { armSystemRecordingPath, canStartAfterScopeWarning } from './lib/armCountdown';
export {
  heldRideStart,
  holdRecordingOnSignOut,
  resumeHeldRecordingForAthlete,
} from './lib/holdRecordingOnSignOut';
export { promptInterruptedRecording } from './lib/interruptedRecording';
export { defaultEntrySport, entrySportChips, recordingEntryHref } from './lib/recordEntry';
export { locationServicesOffMessage } from './lib/locationServicesCopy';
export { ALL_DATA_FIELDS, MAX_DATA_FIELDS, fieldsForMode } from './lib/dataFields';
export { CALORIES_ASSUMED_AGE, useCaloriesWeight } from './hooks/useCaloriesWeight';
export { recordingActions } from './lib/recordingActions';
export { recordingStats } from './lib/recordingStats';
export { uploadStatusTone } from './lib/uploadStatusTone';
export type { UploadStatusTone } from './lib/uploadStatusTone';
export {
  getRecordingMode,
  parsePairedEventId,
  parseRecordingType,
  screenRecordingMode,
} from './lib/recordingModes';
export { installRecordingSession } from './lib/recordingSession';
export { discardReviewedRecording } from './lib/discardReview';
export { resumeStoppedRecording } from './lib/resumeStoppedRecording';
export { sessionReturnRoute } from './lib/sessionReturnRoute';
export { shareRecordingFit } from './lib/shareRecordingFit';
export { recordingBackAction, type RecordingBackAction } from './lib/recordingBackAction';
export {
  adoptOwnerlessRecordingBackup,
  settleOwnerlessAdoptions,
} from './lib/storage/recordingBackup';
export {
  adoptOwnerlessRecordings,
  getVisibleRecording,
  holdRecordingsOfOtherAthletes,
  recordingFitExists,
} from './lib/storage/recordingLibrary';
export { readRecordingTrack } from './lib/storage/recordingTrack';
export { startUploadQueue } from './lib/upload/startUploadQueue';
export { useRecordingLiveStore } from './stores/RecordingLiveStore';
export {
  ACCURACY_REJECT_BOUNDS_M,
  AUTO_PAUSE_DURATION_BOUNDS_MS,
  AUTO_PAUSE_THRESHOLD_BOUNDS_KMH,
  initialiseRecordingPreferences,
  useRecordingPreferences,
} from './stores/RecordingPreferencesStore';
export { useRecordingStore, SENSOR_STALE_MS } from './stores/RecordingStore';
export {
  initialiseUploadPermission,
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
  ReviewDraft,
  DataFieldType,
} from './types';
