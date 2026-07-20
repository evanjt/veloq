export { useSensorSession } from './hooks/useSensorSession';
export { useSensorIssue } from './hooks/useSensorIssue';
export { useSensorStore, initializeKnownSensors, getFreshSensorValue } from './store';
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
