/**
 * Scenario: the settings screens that pad their own scroll content take a collapsing large title on
 * iOS. `contentInsetAdjustmentBehavior: 'automatic'` already adds the home-indicator inset there, so
 * a bottom padding that adds it again leaves a doubled gap under the last row. They are stack
 * screens, where the tab bar does not draw, so there is no bar to clear either.
 *
 * Expected behaviour: rendered on iOS under a bottom safe area, the scroll view lets the system
 * inset its content and adds no bottom padding of its own.
 */

import React from 'react';
import { Platform, ScrollView, StyleSheet } from 'react-native';
import { render } from '@testing-library/react-native';

import { headerLargeTitle } from '@/shared/app/screenHeaders';

let mockSegments: string[] = [];

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useSegments: () => mockSegments,
}));
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 47, bottom: 34, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false, colors: { textSecondary: '#888' } }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => ({
      proximityThreshold: 50,
      minSectionLength: 500,
      minActivities: 3,
      divergenceThreshold: 0.2,
    }),
    setSectionConfig: jest.fn(),
    subscribe: () => () => {},
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 50,
    minSectionLength: 500,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
}));
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({
    forceRescan: jest.fn(),
    isScanning: false,
    stillRunning: false,
    result: null,
    failed: false,
    clearResult: jest.fn(),
  }),
}));
// The settings barrels are replaced by components that render nothing, so the screen under test is
// the only thing whose scroll view is looked at.
jest.mock('@/features/settings', () => {
  const stub = () => null;
  return new Proxy(
    {},
    { get: (_t, key) => (key === '__esModule' || typeof key !== 'string' ? undefined : stub) }
  );
});
jest.mock('@/features/sensors', () => ({
  ...jest.requireActual('@/features/sensors/lib/sensorRows'),
  useSensorStore: (selector: (state: object) => unknown) =>
    selector({
      scanning: false,
      discovered: [],
      knownSensors: [],
      connections: {},
      isLoaded: true,
      initialise: jest.fn(),
    }),
  startScan: jest.fn(),
  stopScan: jest.fn(),
  connectPairedSensor: jest.fn(),
  releasePairingConnections: jest.fn(),
  disconnectSensor: jest.fn(),
  requestBlePermissions: jest.fn(),
  isBleAvailable: () => true,
}));

const ROUTES = ['detection-settings', 'recording-settings', 'sensor-settings'];

describe('settings screens that pad their own bottom', () => {
  it.each(ROUTES)('%s takes a large title on iOS', (route) => {
    expect(headerLargeTitle(route, 'ios')).toBe(true);
    expect(headerLargeTitle(route, 'android')).toBe(false);
  });

  it.each(ROUTES)('%s insets the system way and pads nothing for a tab bar', async (route) => {
    Platform.OS = 'ios';
    mockSegments = [route];
    const Screen: React.ComponentType = require(`@/app/${route}`).default;
    const { UNSAFE_getAllByType } = await render(<Screen />);

    const scroll = UNSAFE_getAllByType(ScrollView)[0];
    expect(scroll.props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(StyleSheet.flatten(scroll.props.contentContainerStyle).paddingBottom ?? 0).toBe(0);
  });
});
