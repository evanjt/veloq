import { useRecordingStore } from '@/features/recording';
import { useSensorStore } from '../store';
import { parseRsc } from './gatt';

/**
 * Feed one foot pod frame to the recording. Cadence goes through the same
 * source arbitration as a crank sensor. Speed is recorded only for an indoor
 * session, because GPS builds the outdoor distance and a pod's speed needs a
 * calibration the athlete has not done.
 */
export function applyRscFrame(sensorId: string, bytes: Uint8Array): void {
  const frame = parseRsc(bytes);
  if (!frame) return;
  useSensorStore.getState().setLatest('cadence', frame.cadence, sensorId);
  useRecordingStore.getState().setSensorSample('speed', frame.speed);
}
