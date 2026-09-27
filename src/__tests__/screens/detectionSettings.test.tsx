import React from 'react';
import { View } from 'react-native';
import { render } from '@testing-library/react-native';
import DetectionSettingsScreen from '@/app/detection-settings';
import { useRouteSettings } from '@/features/routes/stores/RouteSettingsStore';

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

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

const mockRescan = { isScanning: false, stillRunning: false, failed: false };
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => ({
    forceRescan: jest.fn(),
    isScanning: mockRescan.isScanning,
    stillRunning: mockRescan.stillRunning,
    result: null,
    failed: mockRescan.failed,
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
 * Scenario: the follow stops at its budget while Rust is still detecting, which
 * the screen used to paint in danger as a rescan that could not finish.
 *
 * Expected behaviour: the athlete is told the run is still going and can leave,
 * and nothing calls it a failure unless the engine did.
 */
describe('a rescan the screen stops watching', () => {
  afterEach(() => {
    mockRescan.isScanning = false;
    mockRescan.stillRunning = false;
    mockRescan.failed = false;
  });

  it('says nothing while the run is inside its budget', () => {
    mockRescan.isScanning = true;

    expect(
      render(<DetectionSettingsScreen />).queryByTestId('detection-rescan-still-running')
    ).toBeNull();
  });

  it('tells the athlete the run is still going and the screen can be left', () => {
    mockRescan.stillRunning = true;

    const tree = render(<DetectionSettingsScreen />);
    expect(tree.getByTestId('detection-rescan-still-running')).toBeTruthy();
    expect(tree.queryByText('settings.rescanFailed')).toBeNull();
  });

  it('keeps the failure wording for a failure the engine reported', () => {
    mockRescan.failed = true;

    const tree = render(<DetectionSettingsScreen />);
    expect(tree.getByText('settings.rescanFailed')).toBeTruthy();
    expect(tree.queryByTestId('detection-rescan-still-running')).toBeNull();
  });
});

/**
 * Scenario: turning route matching off starts a catalogue wipe that can outlive
 * the wait on it, which used to be logged and shown nowhere.
 *
 * Expected behaviour: the switch carries the same still-running line the rescan
 * uses, and nothing while the wipe landed in time.
 */
describe('a catalogue wipe the switch stopped watching', () => {
  afterEach(() => {
    useRouteSettings.setState({ clearNotice: null });
  });

  it('says nothing when the wipe landed inside the wait', () => {
    expect(render(<DetectionSettingsScreen />).queryByTestId('detection-clear-notice')).toBeNull();
  });

  it('tells the athlete the wipe is still going', () => {
    useRouteSettings.setState({ clearNotice: 'settings.stillRunning' });

    const tree = render(<DetectionSettingsScreen />);
    expect(tree.getByTestId('detection-clear-notice')).toBeTruthy();
    expect(tree.getByText('settings.stillRunning')).toBeTruthy();
  });

  it('says which failure the engine reported, not the same line', () => {
    useRouteSettings.setState({ clearNotice: 'engine.failure.database' });

    expect(render(<DetectionSettingsScreen />).getByText('engine.failure.database')).toBeTruthy();
  });
});
