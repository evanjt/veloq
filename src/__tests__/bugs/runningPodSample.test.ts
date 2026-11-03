/**
 * Scenario: a Running Speed and Cadence foot pod is paired for a run.
 *
 * Expected behaviour: its cadence is the run's cadence in steps per minute
 * through the same source arbitration as a crank sensor, and its speed is
 * recorded only for an indoor session, never over GPS.
 */

import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { kindsFromServiceUUIDs } from '@/features/sensors/lib/sensorManager';
import { applyRscFrame } from '@/features/sensors/lib/runningPod';
import { RSC_SERVICE, CSC_SERVICE } from '@/features/sensors/lib/gatt';

const POD = 'pod-1';
const CRANK = 'crank-1';
// speed 3 m/s, cadence 170
const FRAME = new Uint8Array([0x00, 0x00, 0x03, 170]);

beforeEach(() => {
  useSensorStore.getState().dropSources(POD);
  useSensorStore.getState().dropSources(CRANK);
  useSensorStore.setState({ knownSensors: [] });
  useRecordingStore.setState({
    mode: 'gps',
    latestSensor: { heartrate: null, power: null, cadence: null, speed: null },
  });
});

it('lists a foot pod as running cadence', () => {
  expect(kindsFromServiceUUIDs([RSC_SERVICE])).toEqual(['runningCadence']);
  expect(kindsFromServiceUUIDs([CSC_SERVICE, RSC_SERVICE])).toEqual(['cadence', 'runningCadence']);
});

it('records pod cadence as steps per minute', () => {
  applyRscFrame(POD, FRAME);
  expect(useRecordingStore.getState().latestSensor.cadence?.value).toBe(170);
});

it('ignores pod speed over GPS', () => {
  applyRscFrame(POD, FRAME);
  expect(useRecordingStore.getState().latestSensor.speed).toBeNull();
});

it('records pod speed in an indoor session', () => {
  useRecordingStore.setState({ mode: 'indoor' });
  applyRscFrame(POD, FRAME);
  expect(useRecordingStore.getState().latestSensor.speed?.value).toBe(3);
});

it('lets the athlete choose between a pod and a crank sensor for cadence', () => {
  useSensorStore.setState({
    knownSensors: [
      { id: CRANK, name: 'Crank', kinds: ['cadence'] },
      { id: POD, name: 'Pod', kinds: ['runningCadence'], preferredFor: ['cadence'] },
    ],
  });
  useSensorStore.getState().setLatest('cadence', 80, CRANK);
  applyRscFrame(POD, FRAME);
  expect(useRecordingStore.getState().latestSensor.cadence?.value).toBe(170);
});

it('records an indoor sample with the pod speed', () => {
  const now = Date.now();
  useRecordingStore.setState({ status: 'recording', startTime: now - 5000, mode: 'indoor' });
  applyRscFrame(POD, FRAME);
  useRecordingStore.getState().addIndoorSample();
  const { streams } = useRecordingStore.getState();
  expect(streams.speed[streams.speed.length - 1]).toBe(3);
});

it('drops a malformed frame', () => {
  applyRscFrame(POD, new Uint8Array([0x00]));
  expect(useRecordingStore.getState().latestSensor.cadence).toBeNull();
});
