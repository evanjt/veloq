import React from 'react';
import { render } from '@testing-library/react-native';
import DetectionPreviewScreen from '@/app/detection-preview';

/**
 * Scenario: a preview run reports a percentage the screen throws away, so the
 * athlete watches an indeterminate spinner over a bounded job.
 * Expected behaviour: the run renders a 0-100 bar tracking that percentage,
 * and falls back to the spinner alone when no percentage has arrived yet.
 */

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
const mockProgress: { value: unknown } = { value: null };
const mockStatus = { value: 'idle' };

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

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => ({
      proximityThreshold: 200,
      minSectionLength: 150,
      maxSectionLength: 200000,
      minActivities: 2,
      divergenceThreshold: 0.15,
    }),
    setSectionConfig: jest.fn(),
    forceRedetectSections: jest.fn(() => true),
    pollSectionDetection: jest.fn(() => 'idle'),
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 200,
    minSectionLength: 150,
    maxSectionLength: 200000,
    minActivities: 2,
    divergenceThreshold: 0.15,
  },
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
    status: mockStatus.value,
    progress: mockProgress.value,
    result: null,
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

function barWidth(tree: ReturnType<typeof render>) {
  const fill = tree.queryByTestId('preview-progress-fill');
  if (!fill) return null;
  const style = fill.props.style;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  return flat.width;
}

describe('preview run progress', () => {
  afterEach(() => {
    mockProgress.value = null;
    mockStatus.value = 'idle';
  });

  it('draws a bar at the reported percentage', () => {
    mockStatus.value = 'running';
    mockProgress.value = {
      phase: 'analyzing',
      displayName: 'Analysing',
      completed: 4,
      total: 10,
      percent: 40,
    };

    expect(barWidth(render(<DetectionPreviewScreen />))).toBe('40%');
  });

  it('clamps a percentage outside 0 to 100', () => {
    mockStatus.value = 'running';
    mockProgress.value = {
      phase: 'analyzing',
      displayName: 'Analysing',
      completed: 0,
      total: 0,
      percent: 140,
    };

    expect(barWidth(render(<DetectionPreviewScreen />))).toBe('100%');
  });

  it('starts the bar at zero before any percentage arrives', () => {
    mockStatus.value = 'running';
    mockProgress.value = null;

    expect(barWidth(render(<DetectionPreviewScreen />))).toBe('0%');
  });

  it('draws no bar when no run is in flight', () => {
    mockStatus.value = 'idle';

    expect(barWidth(render(<DetectionPreviewScreen />))).toBeNull();
  });
});
