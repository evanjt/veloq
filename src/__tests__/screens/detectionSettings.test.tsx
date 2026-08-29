import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import DetectionSettingsScreen from '@/app/detection-settings';

/**
 * Scenario: dragging a detector slider.
 * Expected behaviour: the engine is written once, on release, because every
 * write clears `processed_activities` and reseeds identities.
 */

const mockSetSectionConfig = jest.fn();
const mockGetSectionConfig = jest.fn(() => ({
  proximityThreshold: 50,
  minSectionLength: 500,
  minActivities: 3,
  divergenceThreshold: 0.2,
}));

jest.mock('@/shared/native/routeEngine', () => ({
  DETECTION_PRESETS: [{ key: 'balanced', value: 0.5, strictness: 0.5, labelKey: 'balanced' }],
  applyDetectionStrictness: jest.fn(),
  getDetectionPresetByValue: () => ({ key: 'balanced', value: 0.5, strictness: 0.5 }),
  getRouteEngine: () => ({
    getSectionConfig: mockGetSectionConfig,
    setSectionConfig: mockSetSectionConfig,
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 50,
    minSectionLength: 500,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
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

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({
    forceRescan: jest.fn(),
    isScanning: false,
    result: null,
    failed: false,
    clearResult: jest.fn(),
  }),
}));

jest.mock('@/features/settings/components', () => ({
  DetectionIllustration: () => null,
  ElevationBackfillStatus: () => null,
}));

function proximitySlider(tree: ReturnType<typeof render>) {
  return tree.UNSAFE_getAllByType(require('@react-native-community/slider').default)[0];
}

describe('detection settings sliders', () => {
  beforeEach(() => {
    mockSetSectionConfig.mockClear();
  });

  it('does not write the engine while the thumb moves', () => {
    const tree = render(<DetectionSettingsScreen />);
    fireEvent(tree.getByTestId('detection-advanced-toggle'), 'press');
    const slider = proximitySlider(tree);
    fireEvent(slider, 'valueChange', 75);
    fireEvent(slider, 'valueChange', 100);
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
  });

  it('writes the released value once', () => {
    const tree = render(<DetectionSettingsScreen />);
    fireEvent(tree.getByTestId('detection-advanced-toggle'), 'press');
    const slider = proximitySlider(tree);
    fireEvent(slider, 'valueChange', 100);
    fireEvent(slider, 'slidingComplete', 100);
    expect(mockSetSectionConfig).toHaveBeenCalledTimes(1);
    expect(mockSetSectionConfig).toHaveBeenCalledWith(
      expect.objectContaining({ proximityThreshold: 100 })
    );
  });
});
