import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import DetectionPreviewScreen from '@/app/detection-preview';

/**
 * Scenario: the detection preview is the only place the detector's sensitivity
 * can be changed.
 * Expected behaviour: the sliders seed from the persisted config, moving them
 * writes nothing, and only Keep commits the staged values to the engine.
 */

const mockSetSectionConfig = jest.fn();
const mockForceRedetect = jest.fn(() => true);
const mockGetSectionConfig = jest.fn(() => ({
  proximityThreshold: 50,
  minSectionLength: 500,
  maxSectionLength: 50000,
  minActivities: 3,
  divergenceThreshold: 0.2,
}));

jest.mock('@/shared/native/routeEngine', () => ({
  getRouteEngine: () => ({
    getSectionConfig: mockGetSectionConfig,
    setSectionConfig: mockSetSectionConfig,
    forceRedetectSections: mockForceRedetect,
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 25,
    minSectionLength: 50,
    maxSectionLength: 2000,
    minActivities: 2,
    divergenceThreshold: 0.05,
  },
}));

const mockStart = jest.fn();
const previewResult = { counts: { current: 4, proposed: 6, kept: 3 }, sections: [] };
let mockResult: typeof previewResult | null = previewResult;

jest.mock('@/features/routes/hooks/usePreviewDetect', () => ({
  usePreviewDetect: () => ({
    status: 'done',
    progress: null,
    result: mockResult,
    suspended: false,
    start: mockStart,
    cancel: jest.fn(),
  }),
}));

jest.mock('@/features/routes/hooks/usePreviewCentres', () => ({
  usePreviewCentres: () => ({
    centres: [{ binKey: 'home', lat: -37.8, lng: 144.9, count: 12 }],
    labels: { home: 'Home' },
  }),
}));

jest.mock('@/features/routes/components', () => ({
  PreviewCentrePicker: () => null,
  PreviewDiffStrip: () => null,
  PreviewMapView: () => null,
  PreviewSectionPopover: () => null,
  PreviewParamPanel: require('@/features/routes/components/preview/PreviewParamPanel')
    .PreviewParamPanel,
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

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn() },
}));

function sliders(tree: ReturnType<typeof render>) {
  return tree.UNSAFE_getAllByType(require('@react-native-community/slider').default);
}

function confirmNextAlert() {
  return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
    buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
  });
}

describe('detection preview sensitivity controls', () => {
  beforeEach(() => {
    mockSetSectionConfig.mockClear();
    mockForceRedetect.mockClear();
    mockForceRedetect.mockReturnValue(true);
    (router.back as jest.Mock).mockClear();
    mockStart.mockClear();
    mockResult = previewResult;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds every slider from the persisted config', () => {
    const tree = render(<DetectionPreviewScreen />);
    expect(sliders(tree).map((s) => s.props.value)).toEqual([50, 500, 50000, 3, 0.2]);
  });

  it('falls back to the validated defaults when the engine has no config', () => {
    mockGetSectionConfig.mockReturnValueOnce(null as never);
    const tree = render(<DetectionPreviewScreen />);
    expect(sliders(tree).map((s) => s.props.value)).toEqual([25, 50, 2000, 2, 0.05]);
  });

  it('writes nothing to the engine while a slider moves', () => {
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 150);
    fireEvent(sliders(tree)[1], 'valueChange', 900);
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
    expect(mockForceRedetect).not.toHaveBeenCalled();
  });

  it('passes the staged values to a preview run without committing them', () => {
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 150);
    fireEvent(tree.getByTestId('preview-run-button'), 'press');
    expect(mockStart).toHaveBeenCalledWith(
      -37.8,
      144.9,
      expect.objectContaining({ proximityThreshold: 150, minSectionLength: 500 })
    );
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
  });

  it('commits the staged values only when Keep is confirmed', () => {
    confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 150);
    fireEvent(sliders(tree)[3], 'valueChange', 5);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(mockSetSectionConfig).toHaveBeenCalledTimes(1);
    expect(mockSetSectionConfig).toHaveBeenCalledWith(
      expect.objectContaining({ proximityThreshold: 150, minActivities: 5 })
    );
    expect(mockForceRedetect).toHaveBeenCalledTimes(1);
  });

  it('leaves the config alone when Keep is cancelled', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 150);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
    expect(mockForceRedetect).not.toHaveBeenCalled();
  });

  it('closes the screen once the re-cut has actually started', () => {
    confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(mockForceRedetect).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('stays on the screen when the engine refuses the re-cut', () => {
    // A refusal lands after the config is already persisted and the evidence
    // cache cleared, so closing here would report a change that never ran.
    mockForceRedetect.mockReturnValue(false);
    confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('states why the re-cut did not start', () => {
    mockForceRedetect.mockReturnValue(false);
    const alert = confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    const [title, message] = alert.mock.calls[alert.mock.calls.length - 1];
    expect(title).toBe('settings.previewKeepRefusedTitle');
    expect(message).toBe('settings.previewKeepRefused');
  });

  it('lets a refused accept be retried without leaving the screen', () => {
    mockForceRedetect.mockReturnValue(false);
    confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    mockForceRedetect.mockReturnValue(true);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(mockForceRedetect).toHaveBeenCalledTimes(2);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('offers no Keep until a run has produced a result', () => {
    mockResult = null;
    const tree = render(<DetectionPreviewScreen />);
    expect(tree.queryByTestId('preview-keep-button')).toBeNull();
    expect(tree.getByTestId('preview-param-panel')).toBeTruthy();
  });
});
