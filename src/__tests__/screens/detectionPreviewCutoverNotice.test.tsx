/**
 * Scenario: every real detect is refused while the detector cutover is owed,
 * and the sections page says detection is paused. The preview is not on that
 * path and is not held: it loads a subset, runs the detector to show what
 * different settings produce, and touches no catalogue until the athlete
 * accepts.
 *
 * Expected behaviour: it keeps running during the hold and says the library is
 * still migrating. A notice, not a door.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import DetectionPreviewScreen from '@/app/detection-preview';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('expo-router', () => ({ router: { back: jest.fn(), push: jest.fn() } }));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));
jest.mock('@expo/vector-icons', () => ({ MaterialCommunityIcons: () => null }));

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

const mockHold = jest.fn<'elevation' | 'cutover' | null, []>(() => null);
jest.mock('@/features/routes', () => ({
  ...jest.requireActual('@/features/routes/hooks/useDetectionHold'),
  useDetectionHold: () => mockHold(),
}));

jest.mock('@/features/routes/hooks/usePreviewDetect', () => ({
  usePreviewDetect: () => ({
    status: 'idle',
    progress: null,
    result: null,
    suspended: false,
    start: jest.fn(),
    cancel: jest.fn(),
  }),
}));

// The panel and the map are their own screens' business; this one is about
// the notice.
jest.mock('@/features/routes/components', () => ({
  PreviewCentrePicker: () => null,
  PreviewDiffStrip: () => null,
  PreviewMapView: () => null,
  PreviewParamPanel: () => null,
  PreviewSectionPopover: () => null,
}));

jest.mock('@/features/routes/hooks/usePreviewCentres', () => ({
  usePreviewCentres: () => ({ centres: [], labels: {} }),
}));
jest.mock('@/features/routes/hooks/usePreviewCurrentSections', () => ({
  usePreviewCurrentSections: () => [],
}));
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ forceRescan: jest.fn() }),
}));

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => null,
    subscribe: () => () => {},
  }),
  UNIFIED_CONFIG: {
    proximityThreshold: 200,
    minSectionLength: 150,
    maxSectionLength: 200000,
    minActivities: 2,
    divergenceThreshold: 0.15,
  },
}));

describe('the preview during the detector cutover', () => {
  beforeEach(() => {
    mockHold.mockReturnValue(null);
  });

  it('says the library is still migrating while the cutover is owed', () => {
    mockHold.mockReturnValue('cutover');
    const { getByTestId } = render(<DetectionPreviewScreen />);

    expect(getByTestId('preview-migrating')).toBeTruthy();
  });

  it('says nothing on a database that owes no cutover', () => {
    const { queryByTestId } = render(<DetectionPreviewScreen />);

    expect(queryByTestId('preview-migrating')).toBeNull();
  });

  /// The elevation backfill is a different kind of gate and has its own
  /// refusal; this notice is about the cutover alone.
  it('says nothing while the elevation backfill holds', () => {
    mockHold.mockReturnValue('elevation');
    const { queryByTestId } = render(<DetectionPreviewScreen />);

    expect(queryByTestId('preview-migrating')).toBeNull();
  });
});
