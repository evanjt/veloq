import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import DetectionSettingsScreen from '@/app/detection-settings';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

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

const mockRescan = { isScanning: false, lapsed: false };
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({
    forceRescan: jest.fn(),
    isScanning: mockRescan.isScanning,
    lapsed: mockRescan.lapsed,
    result: null,
    failed: false,
    clearResult: jest.fn(),
  }),
}));

// Hoisted past the mock factory as a declaration, so the factory can reach it.
function mockJobsLink() {
  return React.createElement(View, { testID: 'background-jobs-link' });
}

// The barrel no longer exports `DetectionIllustration`, so a screen that went
// back to rendering it would render `undefined` and every test here would fail.
jest.mock('@/features/settings/components', () => ({
  BackgroundJobsLink: mockJobsLink,
  ElevationBackfillStatus: () => null,
  CutoverStatus: () => null,
}));

describe('detection settings screen', () => {
  beforeEach(() => {
    mockSetSectionConfig.mockClear();
    mockGetSectionConfig.mockClear();
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

  it('links out to the jobs area rather than being the only home for the backfill', () => {
    const tree = render(<DetectionSettingsScreen />);
    expect(tree.getByTestId('background-jobs-link')).toBeTruthy();
  });

  it('reads no detector config, since nothing on the screen draws it', () => {
    render(<DetectionSettingsScreen />);
    expect(mockGetSectionConfig).not.toHaveBeenCalled();
  });

  it('puts the preview above the re-analyse button', () => {
    const tree = render(<DetectionSettingsScreen />);
    const order = tree.root
      .findAll((node) => typeof node.props.testID === 'string')
      .map((node) => node.props.testID as string);

    expect(order.indexOf('detection-preview-row')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('detection-preview-row')).toBeLessThan(
      order.indexOf('detection-rescan-button')
    );
  });
});

/**
 * Scenario: the rescan's end comes from an announcement, and a long detect and
 * one that will never end look identical while it is going.
 *
 * Expected behaviour: a run past its foreground budget says so on the screen,
 * and a run inside it says nothing.
 */
describe('a rescan that is taking a while', () => {
  afterEach(() => {
    mockRescan.isScanning = false;
    mockRescan.lapsed = false;
  });

  it('says nothing while the run is inside its budget', () => {
    mockRescan.isScanning = true;

    expect(render(<DetectionSettingsScreen />).queryByTestId('detection-rescan-slow')).toBeNull();
  });

  it('tells the athlete a lapsed run is still going', () => {
    mockRescan.isScanning = true;
    mockRescan.lapsed = true;

    expect(render(<DetectionSettingsScreen />).getByTestId('detection-rescan-slow')).toBeTruthy();
  });

  it('says nothing once the run is over', () => {
    mockRescan.lapsed = true;

    expect(render(<DetectionSettingsScreen />).queryByTestId('detection-rescan-slow')).toBeNull();
  });
});
