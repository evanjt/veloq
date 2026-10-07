export { useSensorSession } from './hooks/useSensorSession';
export { useSensorIssue } from './hooks/useSensorIssue';
export { useSensorStore, initializeKnownSensors } from './store';
export {
  startScan,
  stopScan,
  connectKnownSensors,
  disconnectSensor,
  disconnectAllSensors,
  requestBlePermissions,
  isBleAvailable,
} from './lib/sensorManager';
export { startSimulatedSensors, stopSimulatedSensors } from './lib/simulatedSensors';
export type * from './types';
