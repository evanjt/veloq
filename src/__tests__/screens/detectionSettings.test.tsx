import React from 'react';
import { AccessibilityInfo, Alert, Platform, StyleSheet, View } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { routes } from 'veloqrs';
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
    subscribe: () => () => {},
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

// The key alone, or the key with its interpolation values when they are an
// object, so a count reaches the rendered text and a string default does not.
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, arg?: unknown) =>
      arg !== null && typeof arg === 'object' ? `${key}:${JSON.stringify(arg)}` : key,
  }),
}));

const mockRescan: {
  isScanning: boolean;
  stillRunning: boolean;
  failed: boolean;
  result: { before: number; after: number } | null;
} = { isScanning: false, stillRunning: false, failed: false, result: null };
// Holds the result in state, as the hook does, so a screen that clears it is
// seen to clear it.
jest.mock('@/features/routes/hooks/useSectionRescan', () => ({
  useSectionRescan: () => {
    const { useState } = require('react');
    const [result, setResult] = useState(mockRescan.result);
    return {
      forceRescan: jest.fn(),
      isScanning: mockRescan.isScanning,
      stillRunning: mockRescan.stillRunning,
      result,
      failed: mockRescan.failed,
      refusal: null,
      clearResult: () => setResult(null),
    };
  },
}));

jest.mock('@/features/settings/hooks/useBackgroundJobs', () => ({
  useBackgroundJobs: () => [
    {
      id: 'detection',
      state: 'running',
      completed: 1,
      total: 2,
      percent: 50,
      remaining: 1,
      phase: null,
      resumesAt: null,
      pacedDays: null,
      lastRun: null,
    },
  ],
}));

// Hoisted past the mock factory as a declaration, so the factory can reach it.
function mockActivityBar() {
  const { BackgroundJobsActivityBar } = jest.requireActual(
    '@/features/settings/components/BackgroundJobsActivityBar'
  );
  return React.createElement(BackgroundJobsActivityBar);
}

function mockElevationStatus() {
  return React.createElement(View, { testID: 'elevation-backfill-status' });
}

// The barrel no longer exports `DetectionIllustration`, so a screen that went
// back to rendering it would render `undefined` and every test here would fail.
jest.mock('@/features/settings/components', () => ({
  ...jest.requireActual('@/features/settings/components'),
  BackgroundJobsActivityBar: mockActivityBar,
  ElevationBackfillStatus: mockElevationStatus,
  CutoverStatus: () => null,
}));

describe('detection settings screen', () => {
  beforeEach(() => {
    mockSetSectionConfig.mockClear();
    mockGetSectionConfig.mockClear();
  });

  it('insets the background jobs card by the same amount as the button below it', async () => {
    const tree = await render(<DetectionSettingsScreen />);
    // Horizontal margin and padding from the element's outer edge to the screen edge.
    const inset = (testID: string, includeSelf: boolean) => {
      let total = 0;
      const start = tree.getByTestId(testID);
      for (
        let node = includeSelf ? start : (start.parent as typeof start);
        node;
        node = node.parent as typeof node
      ) {
        // A scroll view's content container is a prop of its own, not an ancestor view.
        const content = StyleSheet.flatten(node.props?.contentContainerStyle) ?? {};
        total += Number(content.paddingHorizontal ?? 0);
        if (typeof node.type !== 'string') continue;
        const style = StyleSheet.flatten(node.props?.style) ?? {};
        total += Number(style.marginHorizontal ?? 0) + Number(style.paddingHorizontal ?? 0);
      }
      return total;
    };
    expect(inset('background-jobs-activity', true)).toBe(inset('detection-rescan-button', false));
    expect(inset('background-jobs-activity', true)).toBeGreaterThan(0);
  });

  it('offers no sensitivity sliders', async () => {
    const tree = await render(<DetectionSettingsScreen />);
    expect(
      tree.UNSAFE_queryAllByType(require('@react-native-community/slider').default)
    ).toHaveLength(0);
    expect(tree.queryByTestId('detection-advanced-toggle')).toBeNull();
    expect(tree.queryByTestId('detection-advanced-panel')).toBeNull();
  });

  it('offers no sensitivity presets', async () => {
    const tree = await render(<DetectionSettingsScreen />);
    expect(tree.queryByText('settings.detectionSensitivity')).toBeNull();
    expect(tree.queryByText('settings.balanced')).toBeNull();
    expect(tree.queryByText('settings.default')).toBeNull();
  });

  it('never writes the detector config from this screen', async () => {
    await render(<DetectionSettingsScreen />);
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
  });

  it('keeps the rescan button and the route into the preview', async () => {
    const tree = await render(<DetectionSettingsScreen />);
    expect(tree.getByTestId('detection-rescan-button')).toBeTruthy();
    expect(tree.getByTestId('detection-preview-row')).toBeTruthy();
  });

  describe('the retired sections row', () => {
    const mockedRead = routes.getRoutesScreenData as unknown as jest.Mock;

    beforeEach(() => {
      mockedRead.mockReset();
      (router.push as jest.Mock).mockClear();
    });

    it('stays in place but disabled, saying none retired, while the library retired nothing', async () => {
      mockedRead.mockReturnValue({ ledgerRetiredCount: 0 });
      const tree = await render(<DetectionSettingsScreen />);

      const row = tree.getByTestId('retired-sections-row');
      expect(row).toHaveTextContent(/sectionHistory\.retiredEmpty/);
      expect(row).toBeDisabled();
      await fireEvent.press(row);
      expect(router.push).not.toHaveBeenCalledWith('/detection-preview?layer=retired');
    });

    it('shows the count and opens the retired sections once some retired', async () => {
      mockedRead.mockReturnValue({ ledgerRetiredCount: 2 });
      const tree = await render(<DetectionSettingsScreen />);

      const row = tree.getByTestId('retired-sections-row');
      expect(row).toHaveTextContent(/sectionHistory\.retiredCount:\{"count":2\}/);
      await fireEvent.press(row);
      expect(router.push).toHaveBeenCalledWith('/detection-preview?layer=retired');
    });
  });

  it('shows the activity bar on the screen that starts detection', async () => {
    const tree = await render(<DetectionSettingsScreen />);
    expect(tree.getByTestId('background-jobs-activity')).toBeTruthy();
  });

  it('reads no detector config, since nothing on the screen draws it', async () => {
    await render(<DetectionSettingsScreen />);
    expect(mockGetSectionConfig).not.toHaveBeenCalled();
  });

  it('puts the preview above the re-analyse button', async () => {
    const tree = await render(<DetectionSettingsScreen />);
    const order = tree.root
      .findAll((node) => typeof node.props.testID === 'string')
      .map((node) => node.props.testID as string);

    expect(order.indexOf('detection-preview-row')).toBeGreaterThanOrEqual(0);
    expect(order.indexOf('detection-preview-row')).toBeLessThan(
      order.indexOf('detection-rescan-button')
    );
  });
});

it('keeps elevation controls enabled when route matching is off', async () => {
  useRouteSettings.setState((state) => ({ settings: { ...state.settings, enabled: false } }));
  try {
    const tree = await render(<DetectionSettingsScreen />);
    let node = tree.getByTestId('elevation-backfill-status').parent;
    while (node) {
      expect(node.props.pointerEvents).not.toBe('none');
      node = node.parent;
    }
  } finally {
    useRouteSettings.setState((state) => ({ settings: { ...state.settings, enabled: true } }));
  }
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

  it('says nothing while the run is inside its budget', async () => {
    mockRescan.isScanning = true;

    expect(
      await (
        await render(<DetectionSettingsScreen />)
      ).queryByTestId('detection-rescan-still-running')
    ).toBeNull();
  });

  it('tells the athlete the run is still going and the screen can be left', async () => {
    mockRescan.stillRunning = true;

    const tree = await render(<DetectionSettingsScreen />);
    expect(tree.getByTestId('detection-rescan-still-running')).toBeTruthy();
    expect(tree.queryByText('settings.rescanFailed')).toBeNull();
  });

  it('keeps the failure wording for a failure the engine reported', async () => {
    mockRescan.failed = true;

    const tree = await render(<DetectionSettingsScreen />);
    expect(tree.getByText('settings.rescanFailed')).toBeTruthy();
    expect(tree.queryByTestId('detection-rescan-still-running')).toBeNull();
  });
});

/**
 * Scenario: with route matching off, the previews and Reanalyse cannot run.
 * They were dimmed by an opacity wrapper, which a screen reader cannot hear, so
 * VoiceOver and TalkBack announced them as live buttons that did nothing.
 *
 * Expected behaviour: each control reports itself disabled and refuses the
 * press, and a caption says why.
 */
describe('with route matching off', () => {
  const CONTROLS = [
    'detection-preview-row',
    'route-grouping-preview-row',
    'detection-rescan-button',
  ];

  function renderWithMatching(enabled: boolean) {
    useRouteSettings.setState((state) => ({ settings: { ...state.settings, enabled } }));
    return render(<DetectionSettingsScreen />);
  }

  afterEach(() => {
    useRouteSettings.setState((state) => ({ settings: { ...state.settings, enabled: true } }));
  });

  it.each(CONTROLS)('reports %s as disabled', async (testID) => {
    const tree = await renderWithMatching(false);
    expect(tree.getByTestId(testID).props.accessibilityState).toMatchObject({ disabled: true });
    expect(tree.getByTestId(testID)).toBeDisabled();
  });

  it('says route matching is off', async () => {
    const tree = await renderWithMatching(false);
    expect(tree.getByTestId('detection-matching-off')).toHaveTextContent(
      'settings.routeMatchingOff'
    );
  });

  it.each(CONTROLS)('reports %s as enabled with matching on', async (testID) => {
    const tree = await renderWithMatching(true);
    expect(tree.getByTestId(testID).props.accessibilityState?.disabled ?? false).toBe(false);
    expect(tree.queryByTestId('detection-matching-off')).toBeNull();
  });
});

/**
 * Scenario: a rescan finishes and the screen prints what it found.
 *
 * Expected behaviour: the line names the count before and after, stays until
 * the athlete does something else, and is spoken on arrival.
 */
describe('a finished rescan', () => {
  const os = Platform.OS;

  beforeEach(() => {
    jest.useFakeTimers();
    Platform.OS = 'ios';
    (AccessibilityInfo.announceForAccessibility as jest.Mock).mockClear();
    mockRescan.result = { before: 40, after: 42 };
  });

  afterEach(() => {
    jest.useRealTimers();
    Platform.OS = os;
    mockRescan.result = null;
  });

  it('keeps the before and after on screen past any timeout and announces both', async () => {
    const tree = await render(<DetectionSettingsScreen />);

    await act(() => jest.advanceTimersByTime(6000));

    const line = tree.getByTestId('detection-rescan-result');
    expect(line).toHaveTextContent(/"before":40/);
    expect(line).toHaveTextContent(/"after":42/);
    expect(AccessibilityInfo.announceForAccessibility).toHaveBeenCalledWith(
      expect.stringMatching(/"before":40.*"after":42/)
    );
  });

  it('marks the result as a polite live region and a failure as an assertive one', async () => {
    const polite = await render(<DetectionSettingsScreen />);
    expect(liveRegionOf(polite.getByTestId('detection-rescan-result'))).toBe('polite');
    await polite.unmount();

    mockRescan.result = null;
    mockRescan.failed = true;
    try {
      const assertive = await render(<DetectionSettingsScreen />);
      expect(liveRegionOf(assertive.getByText('settings.rescanFailed'))).toBe('assertive');
    } finally {
      mockRescan.failed = false;
    }
  });
});

/**
 * Scenario: Reanalyse replaces every unaccepted auto-detected section.
 * Expected behaviour: the confirm names the action rather than a generic
 * Confirm, and is styled destructive so iOS paints it red.
 */
it('confirms Reanalyse with a destructive button that names the action', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  try {
    const tree = await render(<DetectionSettingsScreen />);
    await fireEvent.press(tree.getByTestId('detection-rescan-button'));

    const buttons = alert.mock.calls[0][2] ?? [];
    const positive = buttons[buttons.length - 1];
    expect(positive.text).toBe('settings.reanalyzeSections');
    expect(positive.style).toBe('destructive');
    expect(buttons.map((button) => button.text)).not.toContain('common.confirm');
  } finally {
    alert.mockRestore();
  }
});

function liveRegionOf(node: { props: Record<string, unknown>; parent: unknown }): unknown {
  let at: { props: Record<string, unknown>; parent: unknown } | null = node;
  while (at) {
    if (at.props.accessibilityLiveRegion) return at.props.accessibilityLiveRegion;
    at = at.parent as typeof at;
  }
  return undefined;
}
