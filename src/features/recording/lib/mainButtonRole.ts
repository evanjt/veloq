import type { RecordingMode, RecordingStatus } from '@/types';

/**
 * The fill role of the recording bar's one main button. Start and Resume begin
 * recording, so they take the record red. Pause, Review and the manual Save act
 * on a ride already begun, so they take the action blue.
 */
export type MainButtonRole = 'record' | 'action';

export function mainButtonRole(status: RecordingStatus, mode: RecordingMode): MainButtonRole {
  if (mode === 'manual') return 'action';
  return status === 'idle' || status === 'paused' ? 'record' : 'action';
}
