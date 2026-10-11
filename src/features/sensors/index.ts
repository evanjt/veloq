export { useSensorSession } from './hooks/useSensorSession';
export { useSensorIssue } from './hooks/useSensorIssue';
export { useSensorStore, initialiseKnownSensors } from './store';
export {
  startScan,
  stopScan,
  connectKnownSensors,
  disconnectSensor,
  disconnectAllSensors,
  requestBlePermissions,
  refreshBleAccess,
  isBleAvailable,
  turnOnBluetooth,
} from './lib/sensorManager';
export { startSimulatedSensors, stopSimulatedSensors } from './lib/simulatedSensors';
export type * from './types';
