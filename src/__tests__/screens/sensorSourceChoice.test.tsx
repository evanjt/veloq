/**
 * Scenario: two paired sensors supply one metric, and only one of them can be
 * recorded.
 *
 * Expected behaviour: each paired row shows the metrics it supplies, marks the
 * ones recorded from it, and a tap on another row's metric makes that sensor
 * the source and persists the choice.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import SensorSettingsScreen from '@/app/sensor-settings';
import { useSensorStore } from '@/features/sensors/store';
import type { KnownSensor } from '@/features/sensors/types';
import { setSetting } from '@/shared/storage';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, string>) =>
      typeof options === 'object' ? `${key} ${options.kind} ${options.name}` : key,
  }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
}));
jest.mock('@/shared/ui', () => ({
  ScreenSafeAreaView: require('react-native').View,
  ScreenScrollView: require('react-native').ScrollView,
  EmptyState: () => null,
  useBottomClearance: () => 0,
  useScrollEndInset: () => 0,
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

const CHEST: KnownSensor = { id: 'chest', name: 'Chest strap', kinds: ['heartRate'] };
const ARM: KnownSensor = { id: 'arm', name: 'Arm band', kinds: ['heartRate'] };
const METER: KnownSensor = { id: 'meter', name: 'Crank meter', kinds: ['power'] };

const chip = (sensorId: string, kind: string) =>
  screen.getByTestId(`sensor-source-${sensorId}-${kind}`);
const selected = (sensorId: string, kind: string) =>
  chip(sensorId, kind).props.accessibilityState?.selected;

beforeEach(() => {
  jest.clearAllMocks();
  useSensorStore.setState({
    knownSensors: [CHEST, ARM, METER],
    connections: {},
    activeSources: {},
    suppliedKinds: {},
    isLoaded: true,
  });
});

it('marks the sensor paired first as the source of a shared metric', () => {
  render(<SensorSettingsScreen />);

  expect(selected('chest', 'heartRate')).toBe(true);
  expect(selected('arm', 'heartRate')).toBe(false);
  expect(selected('meter', 'power')).toBe(true);
  expect(screen.getByText('sensors.chooseSourceHint')).toBeTruthy();
  expect(chip('arm', 'heartRate').props.accessibilityLabel).toBe(
    'sensors.recordFrom sensors.kinds.heartRate Arm band'
  );
});

it('makes the tapped sensor the source and persists the choice', () => {
  render(<SensorSettingsScreen />);

  fireEvent.press(chip('arm', 'heartRate'));

  expect(selected('arm', 'heartRate')).toBe(true);
  expect(selected('chest', 'heartRate')).toBe(false);
  expect(useSensorStore.getState().knownSensors[1]).toEqual({
    ...ARM,
    preferredFor: ['heartRate'],
  });
  expect(setSetting).toHaveBeenCalledWith(
    'veloq-known-sensors',
    expect.stringContaining('"preferredFor":["heartRate"]')
  );
});

it('shows the live source while it is sending, and the cadence a power meter delivers', () => {
  useSensorStore.setState({
    knownSensors: [CHEST, ARM, METER, { id: 'pod', name: 'Cadence pod', kinds: ['cadence'] }],
    activeSources: { heartRate: 'arm', cadence: 'pod' },
    suppliedKinds: { meter: ['power', 'cadence'] },
  });
  render(<SensorSettingsScreen />);

  expect(selected('arm', 'heartRate')).toBe(true);
  expect(selected('chest', 'heartRate')).toBe(false);
  expect(selected('meter', 'cadence')).toBe(false);
  expect(selected('pod', 'cadence')).toBe(true);
});

it('gives no hint when no metric is shared', () => {
  useSensorStore.setState({ knownSensors: [CHEST, METER] });
  render(<SensorSettingsScreen />);

  expect(selected('chest', 'heartRate')).toBe(true);
  expect(screen.queryByText('sensors.chooseSourceHint')).toBeNull();
});
