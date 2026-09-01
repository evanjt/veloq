import React from 'react';
import { render } from '@testing-library/react-native';
import DetectionSettingsScreen from '@/app/detection-settings';

/**
 * Scenario: sensitivity is edited in the preview, which shows the consequence
 * of a change before it is applied.
 * Expected behaviour: this screen carries Route Matching, the illustration,
 * Reanalyse sections and the link into the preview, and no sensitivity control
 * of its own.
 */

const mockSetSectionConfig = jest.fn();
const mockGetSectionConfig = jest.fn(() => ({
  proximityThreshold: 50,
  minSectionLength: 500,
  minActivities: 3,
  divergenceThreshold: 0.2,
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
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
  CutoverStatus: () => null,
}));

describe('detection settings screen', () => {
  beforeEach(() => {
    mockSetSectionConfig.mockClear();
  });

  it('offers no sensitivity sliders', () => {
    const tree = render(<DetectionSettingsScreen />);
    expect(
      tree.UNSAFE_queryAllByType(require('@react-native-community/slider').default)
    ).toHaveLength(0);
    expect(tree.queryByTestId('detection-advanced-toggle')).toBeNull();
    expect(tree.queryByTestId('detection-advanced-panel')).toBeNull();
  });

  it('offers no sensitivity presets', () => {
    const tree = render(<DetectionSettingsScreen />);
    expect(tree.queryByText('settings.detectionSensitivity')).toBeNull();
    expect(tree.queryByText('settings.balanced')).toBeNull();
    expect(tree.queryByText('settings.default')).toBeNull();
  });

  it('never writes the detector config from this screen', () => {
    render(<DetectionSettingsScreen />);
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
  });

  it('keeps the rescan button and the route into the preview', () => {
    const tree = render(<DetectionSettingsScreen />);
    expect(tree.getByTestId('detection-rescan-button')).toBeTruthy();
    expect(tree.getByTestId('detection-preview-row')).toBeTruthy();
  });
});
