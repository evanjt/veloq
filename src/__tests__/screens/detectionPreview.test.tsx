import React from 'react';
import { ScrollView } from 'react-native';
import { render } from '@testing-library/react-native';
import DetectionPreviewScreen from '@/app/detection-preview';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';

/**
 * Scenario: the preview controls scroll under the app's own bottom tab bar.
 * Expected behaviour: the panel reserves the tab bar and its gradient on top
 * of the system inset, so the Preview button clears the bar on every device.
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

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => ({
      proximityThreshold: 50,
      minSectionLength: 500,
      maxSectionLength: 20000,
      minActivities: 3,
      divergenceThreshold: 0.2,
    }),
    setSectionConfig: jest.fn(),
    forceRedetectSections: jest.fn(),
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 20000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
}));

jest.mock('@/features/routes/hooks/usePreviewCentres', () => ({
  usePreviewCentres: () => ({ centres: [], labels: [] }),
}));

jest.mock('@/features/routes/hooks/usePreviewDetect', () => ({
  usePreviewDetect: () => ({
    status: 'idle',
    progress: null,
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

function panelPaddingBottom() {
  const tree = render(<DetectionPreviewScreen />);
  const scroll = tree.UNSAFE_getAllByType(ScrollView)[0];
  const style = scroll.props.contentContainerStyle;
  const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
  tree.unmount();
  return flat.paddingBottom;
}

describe('detection preview bottom buffer', () => {
  afterEach(() => {
    mockInsets.bottom = 0;
  });

  it('reserves the tab bar when the device has no gesture inset', () => {
    mockInsets.bottom = 0;
    expect(panelPaddingBottom()).toBe(TAB_BAR_SAFE_PADDING);
  });

  it('adds the tab bar on top of a large gesture inset', () => {
    mockInsets.bottom = 48;
    expect(panelPaddingBottom()).toBe(48 + TAB_BAR_SAFE_PADDING);
  });

  it('clears the tab bar whatever the inset', () => {
    for (const bottom of [0, 16, 34, 48]) {
      mockInsets.bottom = bottom;
      expect(panelPaddingBottom()).toBeGreaterThanOrEqual(bottom + TAB_BAR_SAFE_PADDING);
    }
  });
});
