import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import DetectionPreviewScreen from '@/app/detection-preview';

/**
 * Scenario: Keep persists the config and starts a whole-library re-cut, then
 * leaves the screen.
 * Expected behaviour: the re-cut goes through the shared rescan hook, so the
 * poll that feeds every progress indicator starts with the run. Calling the
 * engine client directly leaves the recompute invisible.
 */

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => mockInsets,
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

const mockBack = jest.fn();
jest.mock('expo-router', () => ({
  router: { back: () => mockBack() },
}));

const mockSetSectionConfig = jest.fn();
const mockClientForceRedetect = jest.fn(() => true);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => ({
      proximityThreshold: 50,
      minSectionLength: 500,
      maxSectionLength: 20000,
      minActivities: 3,
      divergenceThreshold: 0.2,
    }),
    setSectionConfig: mockSetSectionConfig,
    forceRedetectSections: mockClientForceRedetect,
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 20000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
}));

const mockForceRescan = jest.fn(() => true);
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({
    isScanning: false,
    progress: null,
    result: null,
    failed: false,
    rescan: jest.fn(),
    forceRescan: mockForceRescan,
    clearResult: jest.fn(),
  }),
}));

jest.mock('@/features/routes/hooks/usePreviewCentres', () => ({
  usePreviewCentres: () => ({
    centres: [{ binKey: 'b1', lat: 1, lng: 2, visitTotal: 10 }],
    labels: ['Home'],
  }),
}));

jest.mock('@/features/routes/hooks/usePreviewCurrentSections', () => ({
  usePreviewCurrentSections: () => [],
}));

jest.mock('@/features/routes/hooks/usePreviewDetect', () => ({
  usePreviewDetect: () => ({
    status: 'idle',
    progress: null,
    result: { sections: [], counts: { kept: 1, added: 0, removed: 0 } },
    suspended: false,
    start: jest.fn(),
    cancel: jest.fn(),
    reset: jest.fn(),
  }),
}));

jest.mock('@/features/routes/components', () => ({
  PreviewCentrePicker: () => null,
  PreviewDiffStrip: () => null,
  PreviewMapView: () => null,
  PreviewParamPanel: () => null,
  PreviewSectionPopover: () => null,
}));

function pressKeepAndConfirm() {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
    buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
  });
  const tree = render(<DetectionPreviewScreen />);
  fireEvent.press(tree.getByTestId('preview-keep-button'));
  alert.mockRestore();
  return tree;
}

describe('keeping a preview starts an observable re-cut', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockForceRescan.mockReturnValue(true);
    mockClientForceRedetect.mockReturnValue(true);
  });

  it('starts the re-cut through the rescan hook, not the raw client', () => {
    pressKeepAndConfirm();

    expect(mockSetSectionConfig).toHaveBeenCalledTimes(1);
    expect(mockForceRescan).toHaveBeenCalledTimes(1);
    expect(mockClientForceRedetect).not.toHaveBeenCalled();
  });

  it('leaves the screen once the re-cut is running', () => {
    pressKeepAndConfirm();

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('stays on the screen when the engine refuses the re-cut', () => {
    mockForceRescan.mockReturnValue(false);

    pressKeepAndConfirm();

    expect(mockBack).not.toHaveBeenCalled();
  });

  it('starts nothing when the preview is discarded', () => {
    const tree = render(<DetectionPreviewScreen />);

    fireEvent.press(tree.getByTestId('preview-discard-button'));

    expect(mockSetSectionConfig).not.toHaveBeenCalled();
    expect(mockForceRescan).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});
