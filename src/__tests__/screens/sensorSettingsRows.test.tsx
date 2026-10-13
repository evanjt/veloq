/**
 * Scenario: a scan finds sensors at different distances, some of one model and
 * some with no advertised name, and a paired sensor is sending.
 *
 * Expected behaviour: the nearest sensor is the top row with its signal
 * strength readable, rows sharing a name carry a short device id, an unnamed
 * sensor reads by what it measures, and a connected sensor shows the value it
 * is sending and how old that value is.
 */
import React from 'react';
import { render, screen, within } from '@testing-library/react-native';

import SensorSettingsScreen from '@/app/sensor-settings';
import { useSensorStore } from '@/features/sensors/store';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import type { DiscoveredSensor, KnownSensor } from '@/features/sensors/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      typeof options === 'object' ? `${key} ${Object.values(options).join(' ')}` : key,
  }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/shared/ui', () => ({
  ScreenSafeAreaView: require('react-native').View,
  ScreenScrollView: require('react-native').ScrollView,
  EmptyState: () => null,
  useTabBarClearance: () => 0,
  signalColor: () => 'green',
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (c: unknown) => c,
}));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn(async () => null),
  setSetting: jest.fn(async () => undefined),
  removeSetting: jest.fn(async () => undefined),
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides()
);
jest.mock('@/features/sensors', () => ({
  ...jest.requireActual('@/features/sensors/lib/sensorRows'),
  useSensorStore: require('@/features/sensors/store').useSensorStore,
  startScan: jest.fn(),
  stopScan: jest.fn(),
  connectPairedSensor: jest.fn(),
  releasePairingConnections: jest.fn(),
  disconnectSensor: jest.fn(),
  isBleAvailable: () => true,
  refreshBleAccess: jest.fn(),
  turnOnBluetooth: jest.fn(),
  displayedSensorSource: require('@/features/sensors/lib/sensorSource').displayedSensorSource,
  metricsSuppliedBy: require('@/features/sensors/lib/sensorSource').metricsSuppliedBy,
}));

const FAR: DiscoveredSensor = {
  id: 'AA:BB:CC:DD:12:34',
  name: 'Trail Strap',
  kinds: ['heartRate'],
  rssi: -80,
};
const NEAR: DiscoveredSensor = {
  id: 'AA:BB:CC:DD:56:78',
  name: 'Trail Strap',
  kinds: ['heartRate'],
  rssi: -50,
};
const UNNAMED: DiscoveredSensor = {
  id: 'AA:BB:CC:DD:9A:BC',
  name: 'AA:BB:CC:DD:9A:BC',
  kinds: ['power'],
  rssi: null,
};

const discoveredOrder = () =>
  screen.getAllByTestId(/^sensor-discovered-/).map((row) => row.props.testID);
const rowText = (testID: string) =>
  within(screen.getByTestId(testID))
    .queryAllByText(/./)
    .map((node) => [node.props.children].flat().join(''))
    .join(' | ');

beforeEach(() => {
  jest.useRealTimers();
  useSensorStore.setState({
    availability: 'ready',
    scanning: true,
    scanFinished: false,
    discovered: [],
    knownSensors: [],
    connections: {},
    activeSources: {},
    suppliedKinds: {},
    isLoaded: true,
  });
  useRecordingStore.setState({
    latestSensor: { heartrate: null, power: null, cadence: null },
  });
});

it('lists the nearest sensor first and tells two of one model apart', () => {
  useSensorStore.setState({ discovered: [FAR, NEAR] });
  render(<SensorSettingsScreen />);

  expect(discoveredOrder()).toEqual([
    `sensor-discovered-${NEAR.id}`,
    `sensor-discovered-${FAR.id}`,
  ]);
  const near = rowText(`sensor-discovered-${NEAR.id}`);
  const far = rowText(`sensor-discovered-${FAR.id}`);
  expect(near).toContain('Trail Strap · 5678');
  expect(far).toContain('Trail Strap · 1234');
  expect(near).not.toEqual(far);
});

it('reads the signal strength in dBm and places a sensor with none last', () => {
  useSensorStore.setState({ discovered: [UNNAMED, FAR, NEAR] });
  render(<SensorSettingsScreen />);

  expect(discoveredOrder()[2]).toBe(`sensor-discovered-${UNNAMED.id}`);
  expect(screen.getByTestId(`sensor-signal-${NEAR.id}`).props.accessibilityLabel).toBe(
    'sensors.signal -50'
  );
  expect(screen.queryByTestId(`sensor-signal-${UNNAMED.id}`)).toBeNull();
  expect(screen.getByTestId(`sensor-discovered-${NEAR.id}`).props.accessibilityLabel).toContain(
    'sensors.signal -50'
  );
});

it('names an unnamed sensor by what it measures, never by its device id', () => {
  useSensorStore.setState({ discovered: [UNNAMED] });
  render(<SensorSettingsScreen />);

  const text = rowText(`sensor-discovered-${UNNAMED.id}`);
  expect(text).toContain('sensors.unnamed sensors.kinds.power');
  expect(text).not.toContain(UNNAMED.id);
});

it('shows the value a connected source is sending and its age', () => {
  const strap: KnownSensor = { id: 'strap', name: 'Trail Strap', kinds: ['heartRate'] };
  const meter: KnownSensor = { id: 'meter', name: 'Crank meter', kinds: ['power'] };
  useSensorStore.setState({
    knownSensors: [strap, meter],
    connections: {
      strap: { status: 'connected', name: strap.name, kinds: strap.kinds },
      meter: { status: 'connecting', name: meter.name, kinds: meter.kinds },
    },
    activeSources: { heartRate: 'strap' },
  });
  useRecordingStore.setState({
    latestSensor: {
      heartrate: { value: 142.4, at: Date.now() - 3000 },
      power: { value: 250, at: Date.now() },
      cadence: null,
    },
  });
  render(<SensorSettingsScreen />);

  expect(screen.getByTestId('sensor-live-strap-heartRate')).toHaveTextContent(
    'sensors.lastSample 142 bpm 3'
  );
  expect(screen.queryByTestId('sensor-live-meter-power')).toBeNull();
});

it('shows no value for a connected sensor that is not the source of its metric', () => {
  const first: KnownSensor = { id: 'first', name: 'Chest strap', kinds: ['heartRate'] };
  const second: KnownSensor = { id: 'second', name: 'Arm band', kinds: ['heartRate'] };
  useSensorStore.setState({
    knownSensors: [first, second],
    connections: {
      first: { status: 'connected', name: first.name, kinds: first.kinds },
      second: { status: 'connected', name: second.name, kinds: second.kinds },
    },
    activeSources: { heartRate: 'second' },
  });
  useRecordingStore.setState({
    latestSensor: { heartrate: { value: 120, at: Date.now() }, power: null, cadence: null },
  });
  render(<SensorSettingsScreen />);

  expect(screen.queryByTestId('sensor-live-first-heartRate')).toBeNull();
  expect(screen.getByTestId('sensor-live-second-heartRate')).toBeTruthy();
});

it('tells two paired sensors of one model apart', () => {
  useSensorStore.setState({
    knownSensors: [
      { id: 'AA:BB:CC:DD:12:34', name: 'Trail Strap', kinds: ['heartRate'] },
      { id: 'AA:BB:CC:DD:56:78', name: 'Trail Strap', kinds: ['heartRate'] },
    ],
  });
  render(<SensorSettingsScreen />);

  expect(rowText('sensor-paired-AA:BB:CC:DD:12:34')).toContain('Trail Strap · 1234');
  expect(rowText('sensor-paired-AA:BB:CC:DD:56:78')).toContain('Trail Strap · 5678');
});
