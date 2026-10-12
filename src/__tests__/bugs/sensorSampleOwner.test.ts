/**
 * Scenario: every heart rate, power and cadence notification wrote the sample
 * twice, once into the sensors store's own map, which nothing on screen reads
 * and which carried a second stale window, and once into the recording store,
 * which every tile and the recorder read.
 *
 * Expected behaviour: the recording store holds the one live sample, and a
 * notification from the sensor already supplying its metric wakes nothing
 * subscribed to the sensors store.
 */

import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

const STRAP = 'strap-1';

beforeEach(() => {
  useSensorStore.getState().dropSources(STRAP);
  useRecordingStore.setState({ latestSensor: { heartrate: null, power: null, cadence: null } });
});

it('lands each kind in the recording store under its stream name', () => {
  const { setLatest } = useSensorStore.getState();
  setLatest('heartRate', 152, STRAP);
  setLatest('power', 240, STRAP);
  setLatest('cadence', 88, STRAP);

  const { latestSensor } = useRecordingStore.getState();
  expect(latestSensor.heartrate?.value).toBe(152);
  expect(latestSensor.power?.value).toBe(240);
  expect(latestSensor.cadence?.value).toBe(88);
});

it('does not notify the sensors store on a notification from the sitting source', () => {
  useSensorStore.getState().setLatest('heartRate', 151, STRAP);
  const listener = jest.fn();
  const unsubscribe = useSensorStore.subscribe(listener);
  try {
    useSensorStore.getState().setLatest('heartRate', 152, STRAP);
    useSensorStore.getState().setLatest('heartRate', 153, STRAP);
  } finally {
    unsubscribe();
  }
  expect(listener).not.toHaveBeenCalled();
});
