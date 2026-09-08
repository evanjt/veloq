/**
 * Scenario: a config change clears the processed set so the whole library is
 * re-detected, and that re-detect is asynchronous. Between the write and its
 * completion the sliders read as untouched, because they show the new config,
 * and the proposal is cut with it. The live side is still the previous
 * config's cut, so every section that moved is reported once as gone and once
 * as new.
 *
 * Expected behaviour: the screen says the live catalogue has not caught up,
 * with the count, so the athlete can tell that apart from a detector
 * regression. It was 89 gone of 118 on the device with no detector fault at
 * all, and nothing on screen said why.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import DetectionPreviewScreen from '@/app/detection-preview';
import { initializeI18n, changeLanguage } from '@/i18n';

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

jest.mock('@/features/routes', () => ({
  ...jest.requireActual('@/features/routes/hooks/useDetectionHold'),
  useDetectionHold: () => null,
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

jest.mock('@/features/routes/components', () => ({
  PreviewCentrePicker: () => null,
  PreviewDiffStrip: () => null,
  PreviewRunCost: () => null,
  PreviewMapView: () => null,
  PreviewParamPanel: () => null,
  PreviewSectionPopover: () => null,
}));

jest.mock('@/features/routes/hooks/usePreviewCentres', () => ({
  usePreviewCentres: () => ({ centres: [], labels: {} }),
}));
jest.mock('@/features/routes/hooks/usePreviewCurrentSections', () => ({
  usePreviewCurrentSections: () => ({ sections: [], failed: false }),
}));
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({ forceRescan: jest.fn() }),
}));

const mockAwaiting = jest.fn<number | null, []>(() => 0);

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSectionConfig: () => null,
    sectionDetectionAwaiting: () => mockAwaiting(),
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

describe('the preview against a catalogue that has not caught up', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(async () => {
    await changeLanguage('en-AU');
    mockAwaiting.mockReturnValue(0);
  });

  it('says the catalogue is behind when the config change cleared the whole set', () => {
    mockAwaiting.mockReturnValue(118);
    const { getByTestId } = render(<DetectionPreviewScreen />);

    expect(getByTestId('preview-stale-catalogue')).toBeTruthy();
  });

  /// The count is in the sentence rather than a fixed warning, because it is
  /// what separates "three new rides" from "the whole library". Asserted
  /// against the rendered sentence, so a regression to a countless string
  /// fails here rather than passing on a key that still resolves.
  it('names how many activities the live catalogue has never seen', () => {
    mockAwaiting.mockReturnValue(118);
    const { getByTestId } = render(<DetectionPreviewScreen />);

    expect(getByTestId('preview-stale-catalogue')).toHaveTextContent(
      /has not seen 118 of your activities yet/
    );
  });

  it('says nothing when the catalogue has seen every activity', () => {
    const { queryByTestId } = render(<DetectionPreviewScreen />);

    expect(queryByTestId('preview-stale-catalogue')).toBeNull();
  });

  /// An engine that cannot answer must not read as "everything is fine", but
  /// it must not invent a staleness either. Silence is the honest answer, and
  /// it is what the count returning null means.
  it('says nothing when the engine cannot answer', () => {
    mockAwaiting.mockReturnValue(null);
    const { queryByTestId } = render(<DetectionPreviewScreen />);

    expect(queryByTestId('preview-stale-catalogue')).toBeNull();
  });
});
