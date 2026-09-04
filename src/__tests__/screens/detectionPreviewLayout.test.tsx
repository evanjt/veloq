import React from 'react';
import { ScrollView, View as mockView } from 'react-native';
import Slider from '@react-native-community/slider';
import { PreviewCentrePicker as mockCentrePicker } from '@/features/routes/components/preview/PreviewCentrePicker';
import { PreviewParamPanel as mockParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { PreviewDiffStrip as mockDiffStrip } from '@/features/routes/components/preview/PreviewDiffStrip';
import { render } from '@testing-library/react-native';
import DetectionPreviewScreen from '@/app/detection-preview';

/**
 * Scenario: the preview screen puts the picker, the five sliders and the
 * decision row in a vertical ScrollView under the map, so tuning a slider
 * scrolls the map off screen, which is the one thing the screen is for.
 * Expected behaviour: nothing on this screen scrolls vertically. The map and
 * every control share one fixed layout, and the diff strip and decision row
 * arrive without pushing either out of the tree.
 */

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };
const mockResult: { value: unknown } = { value: null };

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => mockInsets,
  SafeAreaProvider: mockView,
  SafeAreaView: mockView,
}));

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
    centres: [
      { binKey: 'b1', lat: 1, lng: 2, visitTotal: 10, sectionCount: 3, source: 'visits' },
      { binKey: 'b2', lat: 3, lng: 4, visitTotal: 6, sectionCount: 1, source: 'sections' },
    ],
    labels: [
      { label: 'Home', fallbackNumber: 1 },
      { label: 'Coast', fallbackNumber: 2 },
    ],
  }),
}));

jest.mock('@/features/routes/hooks/usePreviewCurrentSections', () => ({
  usePreviewCurrentSections: () => [],
}));

jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ forceRescan: jest.fn(() => true) }),
}));

jest.mock('@/features/routes/hooks/usePreviewDetect', () => ({
  usePreviewDetect: () => ({
    status: 'idle',
    progress: null,
    result: mockResult.value,
    suspended: false,
    start: jest.fn(),
    cancel: jest.fn(),
    reset: jest.fn(),
  }),
}));

// The picker, the sliders and the diff strip are the things that have to fit,
// so they render for real and only the map surface is stubbed. They come
// straight from their own files, aliased through `mock` names because the
// components index pulls the native module in through RoutesList.
jest.mock('@/features/routes/components', () => ({
  PreviewCentrePicker: mockCentrePicker,
  PreviewParamPanel: mockParamPanel,
  PreviewDiffStrip: mockDiffStrip,
  PreviewMapView: () => null,
  PreviewSectionPopover: () => null,
}));

const RESULT_WITH_COUNTS = {
  counts: { unchanged: 3, changed: 1, new: 2, gone: 1 },
  sections: [],
};

// The count alone, because a failed match on the node prints the whole fiber.
function verticalScrollViewCount(tree: ReturnType<typeof render>) {
  return tree.UNSAFE_queryAllByType(ScrollView).filter((node) => !node.props.horizontal).length;
}

describe('preview screen layout', () => {
  afterEach(() => {
    mockResult.value = null;
  });

  it('scrolls nothing vertically, so the map cannot leave the screen', () => {
    const tree = render(<DetectionPreviewScreen />);

    expect(verticalScrollViewCount(tree)).toBe(0);
  });

  it('keeps the area picker horizontal rather than making the column scroll', () => {
    const tree = render(<DetectionPreviewScreen />);

    expect(tree.getByTestId('preview-centre-picker').props.horizontal).toBe(true);
  });

  it('holds the map and all five sliders in the tree at once', () => {
    const tree = render(<DetectionPreviewScreen />);

    expect(tree.getByTestId('preview-map')).toBeTruthy();
    const panel = tree.getByTestId('preview-param-panel');
    expect(panel.findAllByType(Slider)).toHaveLength(5);
    expect(panel.findAllByType(ScrollView)).toHaveLength(0);
  });

  it('lets the slider card absorb the leftover height rather than fixing its own', () => {
    const tree = render(<DetectionPreviewScreen />);

    const style = tree.getByTestId('preview-param-panel').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    expect(flat.flex).toBe(1);
    expect(flat.height).toBeUndefined();
  });

  it('keeps Preview reachable once a result has arrived', () => {
    mockResult.value = RESULT_WITH_COUNTS;
    const tree = render(<DetectionPreviewScreen />);

    expect(tree.getByTestId('preview-run-button')).toBeTruthy();
  });

  it('adds the diff strip and the decision row without displacing the map or the sliders', () => {
    mockResult.value = RESULT_WITH_COUNTS;
    const tree = render(<DetectionPreviewScreen />);

    expect(tree.getByTestId('preview-keep-button')).toBeTruthy();
    expect(tree.getByTestId('preview-discard-button')).toBeTruthy();
    expect(tree.getByTestId('preview-map')).toBeTruthy();
    expect(tree.getByTestId('preview-param-panel')).toBeTruthy();
    expect(verticalScrollViewCount(tree)).toBe(0);
  });
});
