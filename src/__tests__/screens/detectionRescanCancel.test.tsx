/**
 * Scenario: a rescan started from this screen ran to its end whatever the
 * athlete did. The button went disabled with a spinner and there was nothing
 * to press, because `DetectionManager` exposed no cancel at all.
 *
 * Expected behaviour: the button becomes a Cancel while a scan is running, and
 * pressing it asks the run to stop. It stays pressable, since a disabled
 * control is the shape that left the athlete with no way out.
 */

import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';

import DetectionSettingsScreen from '@/app/detection-settings';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockCancelSectionDetection = jest.fn(() => true);
let mockScanning = false;

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({
    rescan: jest.fn(),
    forceRescan: jest.fn(),
    cancelScan: mockCancelSectionDetection,
    refusal: null,
    isScanning: mockScanning,
    progress: null,
    result: null,
    failed: false,
    clearResult: jest.fn(),
  }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => ({
      proximityThreshold: 50,
      minSectionLength: 500,
      minActivities: 3,
      divergenceThreshold: 0.2,
    }),
    setSectionConfig: jest.fn(),
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 50,
    minSectionLength: 500,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/features/settings/components', () => ({
  BackgroundJobsLink: () => null,
  ElevationBackfillStatus: () => null,
  CutoverStatus: () => null,
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

beforeEach(() => {
  mockCancelSectionDetection.mockClear();
  mockScanning = false;
});

it('asks the run to stop when the button is pressed mid-scan', () => {
  mockScanning = true;
  render(<DetectionSettingsScreen />);

  fireEvent.press(screen.getByTestId('detection-rescan-button'));

  expect(mockCancelSectionDetection).toHaveBeenCalledTimes(1);
});

it('leaves the button pressable while a scan runs', () => {
  mockScanning = true;
  render(<DetectionSettingsScreen />);

  expect(screen.getByTestId('detection-rescan-button').props.accessibilityState?.disabled).not.toBe(
    true
  );
});

it('does not cancel when no scan is running', () => {
  render(<DetectionSettingsScreen />);

  fireEvent.press(screen.getByTestId('detection-rescan-button'));

  expect(mockCancelSectionDetection).not.toHaveBeenCalled();
});
