export * from '@/features/activity/types';
export * from '@/features/routes/types';
export * from './calendar';
export * from '@/features/insights/types';
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
} from '@/features/recording';
export * from '@/features/strength/types';

export type Terrain3DMode = 'off' | 'smart' | 'always';
