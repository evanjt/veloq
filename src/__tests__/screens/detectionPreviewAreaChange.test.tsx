/**
 * Scenario: a preview run has finished and its diff is on the map, then the
 * athlete picks a different riding area.
 *
 * Expected behaviour: the held diff goes with the area it was about. It is
 * held across a re-run of the same area on purpose, so nothing else clears it
 * and a result from one area would otherwise be drawn over another.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import DetectionPreviewScreen from '@/app/detection-preview';
import type { PreviewCentre } from '../../../modules/veloqrs/src/delegates/preview';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
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

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const CONFIG = {
  proximityThreshold: 50,
  minSectionLength: 500,
  maxSectionLength: 20000,
  minActivities: 3,
  divergenceThreshold: 0.2,
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => CONFIG,
    setSectionConfig: jest.fn(),
    forceRedetectSections: jest.fn(),
  }),
  UNIFIED_CONFIG: CONFIG,
}));

const CENTRES: PreviewCentre[] = [
  {
    binKey: 'a',
    lat: -33.86,
    lng: 151.2,
    visitTotal: 20,
    sectionCount: 4,
    source: 'sections',
    locality: null,
  },
  {
    binKey: 'b',
    lat: -37.81,
    lng: 144.96,
    visitTotal: 9,
    sectionCount: 2,
    source: 'sections',
    locality: null,
  },
];

jest.mock('@/features/routes/hooks/usePreviewCentres', () => ({
  usePreviewCentres: () => ({ centres: CENTRES, labels: {} }),
}));

const mockReset = jest.fn();
const mockPreviewState = {
  status: 'complete' as const,
  progress: null,
  result: {
    counts: { current: 2, proposed: 3, unchanged: 1, changed: 1, new: 1, gone: 0 },
    pool: { activities: 12, empty: 0, unreadable: 0 },
    elapsedMs: 900,
  },
  suspended: false,
  start: jest.fn(() => true),
  cancel: jest.fn(),
  reset: mockReset,
};
jest.mock('@/features/routes/hooks/usePreviewDetect', () => ({
  usePreviewDetect: () => mockPreviewState,
}));

// The real picker is a horizontal list; one button per centre is enough to
// make the selection here.
jest.mock('@/features/routes/components', () => {
  const actual = jest.requireActual('@/features/routes/components');
  const { Pressable, Text, View } = require('react-native');
  return {
    ...actual,
    PreviewMapView: () => null,
    PreviewSectionPopover: () => null,
    PreviewCentrePicker: ({
      centres,
      onSelect,
    }: {
      centres: PreviewCentre[];
      onSelect: (c: PreviewCentre) => void;
    }) => (
      <View>
        {centres.map((c) => (
          <Pressable key={c.binKey} testID={`centre-${c.binKey}`} onPress={() => onSelect(c)}>
            <Text>{c.binKey}</Text>
          </Pressable>
        ))}
      </View>
    ),
  };
});

describe('changing the riding area under a finished preview', () => {
  beforeEach(() => mockReset.mockClear());

  it('drops the diff that was about the previous area', () => {
    const tree = render(<DetectionPreviewScreen />);

    fireEvent.press(tree.getByTestId('centre-b'));

    expect(mockReset).toHaveBeenCalledTimes(1);
  });

  it('leaves the diff alone when the same area is picked again', () => {
    const tree = render(<DetectionPreviewScreen />);

    fireEvent.press(tree.getByTestId('centre-a'));

    expect(mockReset).not.toHaveBeenCalled();
  });
});
