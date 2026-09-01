/**
 * Scenario: opening the detection preview screen.
 * Expected behaviour: the map carries the live catalogue for the chosen riding
 * area straight away, so the first thing on screen is what the detector holds
 * today. The Preview button then runs a proposal against it, and the proposal
 * supersedes the catalogue on the map.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import DetectionPreviewScreen from '@/app/detection-preview';
import type {
  PreviewCentre,
  PreviewResult,
  PreviewSection,
} from '../../../modules/veloqrs/src/delegates/preview';

const CENTRE: PreviewCentre = {
  binKey: '9:27',
  lat: 47.5,
  lng: 8.7,
  visitTotal: 40,
  sectionCount: 2,
  source: 'sections',
};

function section(id: string): PreviewSection {
  return {
    id,
    liveId: id,
    status: 'unchanged',
    name: `Section ${id}`,
    sport: 'Ride',
    polylineBase64: 'AAAA',
    visits: 7,
    distanceM: 4200,
    elevationGainM: 88,
    avgGradePercent: 2.1,
    pinned: false,
  };
}

const LIVE_CATALOGUE = [section('live-a'), section('live-b')];

const RESULT: PreviewResult = {
  pool: { activities: 10, empty: 0, unreadable: 0 },
  elapsedMs: 12,
  config: {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 10000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
  counts: { current: 2, proposed: 1, unchanged: 0, changed: 0, new: 1, gone: 2 },
  sections: [{ ...section('proposed-a'), liveId: null, status: 'new' }],
};

const mockGetPreviewCurrentSections = jest.fn((_lat: number, _lng: number) => LIVE_CATALOGUE);
const mockStart = jest.fn();
let mockResult: PreviewResult | null = null;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => ({
      proximityThreshold: 50,
      minSectionLength: 500,
      maxSectionLength: 10000,
      minActivities: 3,
      divergenceThreshold: 0.2,
    }),
    getPreviewCurrentSections: (lat: number, lng: number) =>
      mockGetPreviewCurrentSections(lat, lng),
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 10000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
}));

jest.mock('@/features/routes/hooks/usePreviewCentres', () => ({
  usePreviewCentres: () => ({ centres: [mockCentreRef.current], labels: [null] }),
}));

jest.mock('@/features/routes/hooks/usePreviewDetect', () => ({
  usePreviewDetect: () => ({
    status: 'idle',
    progress: null,
    result: mockResultRef.current,
    suspended: false,
    start: (...args: unknown[]) => mockStartRef.current(...args),
    cancel: jest.fn(),
    reset: jest.fn(),
  }),
}));

jest.mock('@/features/routes/components', () => {
  const { Text, View } = require('react-native');
  return {
    PreviewCentrePicker: () => null,
    PreviewParamPanel: () => null,
    PreviewDiffStrip: () => null,
    PreviewSectionPopover: () => null,
    PreviewMapView: ({
      currentSections,
      result,
    }: {
      currentSections: { id: string }[];
      result: { sections: { id: string }[] } | null;
    }) => (
      <View testID="preview-map">
        <Text testID="preview-map-current">
          {(currentSections ?? []).map((s) => s.id).join(',')}
        </Text>
        <Text testID="preview-map-result">
          {(result?.sections ?? []).map((s) => s.id).join(',')}
        </Text>
      </View>
    ),
  };
});

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('expo-router', () => ({ router: { back: jest.fn() } }));

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

const mockCentreRef = { current: CENTRE };
const mockResultRef = {
  get current() {
    return mockResult;
  },
};
const mockStartRef = { current: mockStart };

describe('detection preview screen', () => {
  beforeEach(() => {
    mockGetPreviewCurrentSections.mockClear();
    mockStart.mockClear();
    mockResult = null;
  });

  it('shows the live catalogue for the chosen area without a run', () => {
    const tree = render(<DetectionPreviewScreen />);

    expect(mockGetPreviewCurrentSections).toHaveBeenCalledWith(CENTRE.lat, CENTRE.lng);
    expect(tree.getByTestId('preview-map-current').props.children).toBe('live-a,live-b');
    expect(mockStart).not.toHaveBeenCalled();
  });

  it('runs the proposal against that catalogue when Preview is pressed', () => {
    const tree = render(<DetectionPreviewScreen />);

    fireEvent.press(tree.getByTestId('preview-run-button'));

    expect(mockStart).toHaveBeenCalledWith(CENTRE.lat, CENTRE.lng, expect.any(Object));
  });

  it('lets a finished proposal supersede the catalogue on the map', () => {
    mockResult = RESULT;
    const tree = render(<DetectionPreviewScreen />);

    expect(tree.getByTestId('preview-map-result').props.children).toBe('proposed-a');
  });
});
