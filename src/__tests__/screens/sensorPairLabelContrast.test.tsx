/**
 * Scenario: a sensor found by a scan is offered as a card whose only action
 * word is "Pair", drawn in the brand teal at 2.49:1 on the white card and in
 * the same teal on the dark card. It is small bold text, under the large-text
 * line, so it owes 4.5:1.
 *
 * Expected behaviour: the Pair label clears 4.5:1 on the card in both themes.
 */
import React from 'react';
import { StyleSheet } from 'react-native';
import { render, screen } from '@testing-library/react-native';

import SensorSettingsScreen from '@/app/sensor-settings';
import { colors, darkColors } from '@/theme';

let mockIsDark = false;

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string, fallback?: string) => fallback ?? key }),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: mockIsDark }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/ui', () => ({
  ScreenSafeAreaView: require('react-native').View,
  ScreenScrollView: require('react-native').ScrollView,
  EmptyState: () => null,
  useBottomClearance: () => 0,
  useScrollEndInset: () => 0,
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (c: unknown) => c,
}));
jest.mock('@/features/sensors', () => {
  const { create } = require('zustand');
  const store = create(() => ({
    scanning: true,
    discovered: [{ id: 'strap-1', name: 'Chest strap', kinds: ['heartRate'], rssi: -60 }],
    knownSensors: [],
    connections: {},
    isLoaded: true,
    initialize: jest.fn(),
  }));
  return {
    ...jest.requireActual('@/features/sensors/lib/sensorRows'),
    useSensorStore: store,
    startScan: jest.fn(),
    stopScan: jest.fn(),
    connectPairedSensor: jest.fn(),
    releasePairingConnections: jest.fn(),
    disconnectSensor: jest.fn(),
    requestBlePermissions: jest.fn(),
    isBleAvailable: () => true,
  };
});

const AA_TEXT = 4.5;

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => {
    const s = parseInt(hex.slice(i, i + 2), 16) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

const flat = (style: unknown) =>
  (StyleSheet.flatten(style as never) ?? {}) as Record<string, unknown>;

it.each([
  ['light', false],
  ['dark', true],
])('draws the Pair label at 4.5:1 on the %s card', async (_theme, isDark) => {
  mockIsDark = isDark;
  await render(<SensorSettingsScreen />);
  const card = flat(screen.getByTestId('sensor-discovered-strap-1').props.style);
  expect(card.backgroundColor).toBe(isDark ? darkColors.surface : colors.surface);
  const label = flat(screen.getByText('Pair').props.style);
  expect(contrast(label.color as string, card.backgroundColor as string)).toBeGreaterThanOrEqual(
    AA_TEXT
  );
});
