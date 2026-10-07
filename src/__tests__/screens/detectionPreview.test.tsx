import { StartOutcome } from 'veloqrs';
import React from 'react';
import { Alert, ScrollView } from 'react-native';
import Slider from '@react-native-community/slider';
import { act, fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';
import { PreviewCentrePicker } from '@/features/routes/components/preview/PreviewCentrePicker';
import { PreviewParamPanel } from '@/features/routes/components/preview/PreviewParamPanel';
import { PreviewDiffStrip } from '@/features/routes/components/preview/PreviewDiffStrip';
import { PreviewRunCost } from '@/features/routes/components/preview/PreviewRunCost';
import DetectionPreviewScreen from '@/app/detection-preview';
import { initializeI18n, changeLanguage } from '@/i18n';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';
import { layout } from '@/theme';
import type {
  PreviewCentre,
  PreviewResult,
  PreviewSection,
} from '../../../modules/veloqrs/src/delegates/preview';

// The binding registers a TurboModule at import time. A hook on this screen's
// import path compares against one of its generated enums, so the stub is the
// module here.
jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

type Slot = React.ComponentType<never> | null;

/**
 * What each describe below sets before its cases run. The mocks read it at
 * render time, so every describe gets the screen's surroundings it was written
 * against: its engine, its hook results, which children render for real, and
 * whether the translations and the app shell are real.
 */
const mockEnv = {
  engine: (): Record<string, unknown> => ({}),
  unifiedConfig: {} as Record<string, number>,
  centres: {} as unknown,
  detect: (): Record<string, unknown> => ({}),
  currentSections: null as unknown,
  rescan: null as (() => unknown) | null,
  hold: null as (() => unknown) | null,
  cutover: null as (() => boolean) | null,
  components: {} as Record<string, Slot>,
  realI18n: false,
  stubShell: false,
};

const mockInsets = { top: 0, bottom: 0, left: 0, right: 0 };

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    ...jest.requireActual('react-native-safe-area-context'),
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

jest.mock('react-i18next', () => {
  const actual = jest.requireActual('react-i18next');
  return {
    ...actual,
    useTranslation: (...args: unknown[]) =>
      mockEnv.realI18n ? actual.useTranslation(...args) : { t: (key: string) => key },
  };
});

jest.mock('react-native-iap', () => ({
  useIAP: () => ({}),
  ErrorCode: {},
}));

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { back: jest.fn(), push: jest.fn() },
  useFocusEffect: (effect: () => void | (() => void)) => require('react').useEffect(effect, []),
}));

jest.mock('@/shared/app', () => {
  const actual = jest.requireActual('@/shared/app');
  return {
    ...actual,
    useTheme: (...args: unknown[]) =>
      mockEnv.stubShell ? { isDark: false } : actual.useTheme(...args),
    useTopSafeArea: (...args: unknown[]) =>
      mockEnv.stubShell
        ? { hasTopBanner: false, topInset: 0, screenEdges: [] }
        : actual.useTopSafeArea(...args),
    useScreenSafeAreaEdges: (...args: unknown[]) =>
      mockEnv.stubShell ? [] : actual.useScreenSafeAreaEdges(...args),
  };
});

jest.mock('@/features/routes/hooks/useDetectionHold', () => {
  const actual = jest.requireActual('@/features/routes/hooks/useDetectionHold');
  return {
    ...actual,
    useDetectionHold: (...args: unknown[]) =>
      mockEnv.hold ? mockEnv.hold() : actual.useDetectionHold(...args),
    useCutoverHeld: (...args: unknown[]) =>
      mockEnv.cutover ? mockEnv.cutover() : actual.useCutoverHeld(...args),
  };
});

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEnv.engine(),
  get UNIFIED_CONFIG() {
    return mockEnv.unifiedConfig;
  },
}));

jest.mock('@/features/routes/hooks/usePreviewCentres', () => ({
  usePreviewCentres: () => mockEnv.centres,
}));

jest.mock('@/features/routes/hooks/usePreviewDetect', () => ({
  usePreviewDetect: () => mockEnv.detect(),
}));

jest.mock('@/features/routes/hooks/usePreviewCurrentSections', () => {
  const actual = jest.requireActual('@/features/routes/hooks/usePreviewCurrentSections');
  return {
    usePreviewCurrentSections: (...args: unknown[]) =>
      mockEnv.currentSections ?? actual.usePreviewCurrentSections(...args),
  };
});

jest.mock('@/features/routes/hooks/useSectionRescan', () => {
  const actual = jest.requireActual('@/features/routes/hooks/useSectionRescan');
  return {
    useSectionRescan: (...args: unknown[]) =>
      mockEnv.rescan ? mockEnv.rescan() : actual.useSectionRescan(...args),
  };
});

jest.mock('@/features/routes/components', () => {
  const { createElement } = require('react');
  const slot = (name: string) =>
    function PreviewSlot(props: Record<string, unknown>) {
      const component = mockEnv.components[name];
      return component
        ? createElement(component as React.ComponentType<Record<string, unknown>>, props)
        : null;
    };
  return {
    PreviewCentrePicker: slot('PreviewCentrePicker'),
    PreviewDiffStrip: slot('PreviewDiffStrip'),
    PreviewRunCost: slot('PreviewRunCost'),
    PreviewMapView: slot('PreviewMapView'),
    PreviewParamPanel: slot('PreviewParamPanel'),
    PreviewSectionPopover: slot('PreviewSectionPopover'),
  };
});

/** Every child stubbed, which is what most describes want: they are about the screen. */
const NO_CHILDREN: Record<string, Slot> = {
  PreviewCentrePicker: null,
  PreviewDiffStrip: null,
  PreviewRunCost: null,
  PreviewMapView: null,
  PreviewParamPanel: null,
  PreviewSectionPopover: null,
};

/** The surroundings each describe starts from before it sets its own. */
function resetEnv() {
  mockInsets.bottom = 0;
  mockEnv.currentSections = null;
  mockEnv.rescan = null;
  mockEnv.hold = null;
  mockEnv.cutover = null;
  mockEnv.components = NO_CHILDREN;
  mockEnv.realI18n = false;
  mockEnv.stubShell = false;
}

function flatten(style: unknown) {
  return Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
}

/**
 * Scenario: the preview controls scroll under the app's own bottom tab bar.
 * Expected behaviour: the panel reserves the tab bar and its gradient on top
 * of the system inset, so the Preview button clears the bar on every device.
 */
describe('detection preview bottom buffer', () => {
  beforeEach(() => {
    resetEnv();
    mockEnv.engine = () => ({
      sectionDetectionAwaiting: () => 0,
      subscribe: () => () => {},
      getSectionConfig: () => ({
        proximityThreshold: 50,
        minSectionLength: 500,
        maxSectionLength: 20000,
        minActivities: 3,
        divergenceThreshold: 0.2,
      }),
      setSectionConfig: jest.fn(),
      forceRedetectSections: jest.fn(),
    });
    mockEnv.unifiedConfig = {
      proximityThreshold: 50,
      minSectionLength: 500,
      maxSectionLength: 20000,
      minActivities: 3,
      divergenceThreshold: 0.2,
    };
    mockEnv.centres = { centres: [], labels: [] };
    mockEnv.detect = () => ({
      status: 'idle',
      progress: null,
      result: null,
      refusal: null,
      start: jest.fn(),
      cancel: jest.fn(),
      reset: jest.fn(),
    });
  });

  function panelPaddingBottom() {
    const tree = render(<DetectionPreviewScreen />);
    const style = tree.getByTestId('preview-control-panel').props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    tree.unmount();
    return flat.paddingBottom;
  }

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

/**
 * Scenario: a preview run has finished and its diff is on the map, then the
 * athlete picks a different riding area.
 *
 * Expected behaviour: the held diff goes with the area it was about. It is
 * held across a re-run of the same area on purpose, so nothing else clears it
 * and a result from one area would otherwise be drawn over another.
 */
describe('changing the riding area under a finished preview', () => {
  const CONFIG = {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 20000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  };

  const CENTRES: PreviewCentre[] = [
    {
      binKey: 'a',
      lat: -33.86,
      lng: 151.2,
      visitTotal: 20,
      sectionCount: 4,
      source: 'sections',
    },
    {
      binKey: 'b',
      lat: -37.81,
      lng: 144.96,
      visitTotal: 9,
      sectionCount: 2,
      source: 'sections',
    },
  ];

  const mockReset = jest.fn();
  const mockPreviewState = {
    status: 'complete' as const,
    progress: null,
    result: {
      counts: { current: 2, proposed: 3, unchanged: 1, changed: 1, new: 1, gone: 0 },
      pool: { activities: 12, empty: 0, unreadable: 0 },
      elapsedMs: 900,
    },
    refusal: null,
    start: jest.fn(() => true),
    cancel: jest.fn(),
    reset: mockReset,
  };

  // The real picker is a horizontal list; one button per centre is enough to
  // make the selection here.
  function CentreButtons({
    centres,
    onSelect,
  }: {
    centres: PreviewCentre[];
    onSelect: (c: PreviewCentre) => void;
  }) {
    const { Pressable, Text, View } = require('react-native');
    return (
      <View>
        {centres.map((c) => (
          <Pressable key={c.binKey} testID={`centre-${c.binKey}`} onPress={() => onSelect(c)}>
            <Text>{c.binKey}</Text>
          </Pressable>
        ))}
      </View>
    );
  }

  beforeEach(() => {
    resetEnv();
    mockEnv.engine = () => ({
      sectionDetectionAwaiting: () => 0,
      subscribe: () => () => {},
      getSectionConfig: () => CONFIG,
      setSectionConfig: jest.fn(),
      forceRedetectSections: jest.fn(),
    });
    mockEnv.unifiedConfig = CONFIG;
    mockEnv.centres = { centres: CENTRES, labels: {} };
    mockEnv.detect = () => mockPreviewState;
    mockEnv.components = {
      PreviewCentrePicker: CentreButtons,
      PreviewDiffStrip: PreviewDiffStrip,
      PreviewRunCost: PreviewRunCost,
      PreviewMapView: null,
      PreviewParamPanel: PreviewParamPanel,
      PreviewSectionPopover: null,
    };
  });

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

/**
 * Scenario: opening the detection preview screen.
 * Expected behaviour: the map carries the live catalogue for the chosen riding
 * area straight away, so the first thing on screen is what the detector holds
 * today. The Preview button then runs a proposal against it, and the proposal
 * supersedes the catalogue on the map.
 */
describe('detection preview screen', () => {
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
      polyline: new ArrayBuffer(0),
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

  function MapWithIds({
    currentSections,
    result,
  }: {
    currentSections: { id: string }[];
    result: { sections: { id: string }[] } | null;
  }) {
    const { Text, View } = require('react-native');
    return (
      <View testID="preview-map">
        <Text testID="preview-map-current">
          {(currentSections ?? []).map((s) => s.id).join(',')}
        </Text>
        <Text testID="preview-map-result">
          {(result?.sections ?? []).map((s) => s.id).join(',')}
        </Text>
      </View>
    );
  }

  beforeEach(() => {
    resetEnv();
    mockEnv.engine = () => ({
      sectionDetectionAwaiting: () => 0,
      subscribe: () => () => {},
      getSectionConfig: () => ({
        proximityThreshold: 50,
        minSectionLength: 500,
        maxSectionLength: 10000,
        minActivities: 3,
        divergenceThreshold: 0.2,
      }),
      getPreviewCurrentSections: (lat: number, lng: number) =>
        mockGetPreviewCurrentSections(lat, lng),
    });
    mockEnv.unifiedConfig = {
      proximityThreshold: 50,
      minSectionLength: 500,
      maxSectionLength: 10000,
      minActivities: 3,
      divergenceThreshold: 0.2,
    };
    mockEnv.centres = { centres: [CENTRE], labels: [null] };
    mockEnv.detect = () => ({
      status: 'idle',
      progress: null,
      result: mockResult,
      refusal: null,
      start: (...args: unknown[]) => mockStart(...args),
      cancel: jest.fn(),
      reset: jest.fn(),
    });
    mockEnv.components = { ...NO_CHILDREN, PreviewMapView: MapWithIds };
  });

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

  it('says so when the catalogue read fails, rather than drawing a blank map', () => {
    mockGetPreviewCurrentSections.mockImplementationOnce(() => {
      throw new Error('engine gone');
    });

    const tree = render(<DetectionPreviewScreen />);

    expect(tree.getByTestId('preview-current-failed').props.children).toBe(
      'settings.previewCurrentFailed'
    );
  });

  it('stays quiet when the area honestly holds nothing', () => {
    mockGetPreviewCurrentSections.mockImplementationOnce(() => []);

    const tree = render(<DetectionPreviewScreen />);

    expect(tree.queryByTestId('preview-current-failed')).toBeNull();
  });
});

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
describe('the preview during the detector cutover', () => {
  const mockCutover = jest.fn<boolean, []>(() => false);

  beforeEach(() => {
    resetEnv();
    mockEnv.realI18n = true;
    mockEnv.stubShell = true;
    mockEnv.cutover = () => mockCutover();
    mockEnv.engine = () => ({
      sectionDetectionAwaiting: () => 0,
      getSectionConfig: () => null,
      subscribe: () => () => {},
    });
    mockEnv.unifiedConfig = {
      proximityThreshold: 200,
      minSectionLength: 150,
      maxSectionLength: 200000,
      minActivities: 2,
      divergenceThreshold: 0.15,
    };
    mockEnv.centres = { centres: [], labels: {} };
    mockEnv.currentSections = { sections: [], failed: false };
    mockEnv.rescan = () => ({ forceRescan: jest.fn() });
    mockEnv.detect = () => ({
      status: 'idle',
      progress: null,
      result: null,
      refusal: null,
      start: jest.fn(),
      cancel: jest.fn(),
    });
  });

  beforeEach(() => {
    mockCutover.mockReturnValue(false);
  });

  it('says the library is still migrating while the cutover is owed', () => {
    mockCutover.mockReturnValue(true);
    const { getByTestId } = render(<DetectionPreviewScreen />);

    expect(getByTestId('preview-migrating')).toBeTruthy();
  });

  it('says nothing on a database that owes no cutover', () => {
    const { queryByTestId } = render(<DetectionPreviewScreen />);

    expect(queryByTestId('preview-migrating')).toBeNull();
  });

  /// The upgrade path owes the cutover and the elevation queue together, and
  /// the hold the hook ranks first is the backfill's. The notice follows the
  /// cutover, not that ranking.
  it('says the library is migrating while elevation is also owed', () => {
    mockEnv.hold = () => 'elevation-waiting';
    mockCutover.mockReturnValue(true);
    const { getByTestId } = render(<DetectionPreviewScreen />);

    expect(getByTestId('preview-migrating')).toBeTruthy();
  });

  it('says nothing when only the elevation backfill is owed', () => {
    mockEnv.hold = () => 'elevation-waiting';
    const { queryByTestId } = render(<DetectionPreviewScreen />);

    expect(queryByTestId('preview-migrating')).toBeNull();
  });

  /// Scenario: the start's refusal is the engine's own answer, and each one
  /// ends differently, so each reads as its own line.
  /// Expected behaviour: the elevation line shows only under an elevation hold.
  describe('a refused start', () => {
    function refusedWith(refusal: StartOutcome | null, hold: string | null) {
      mockEnv.hold = () => hold;
      mockEnv.detect = () => ({
        status: 'idle',
        progress: null,
        result: null,
        refusal,
        start: jest.fn(),
        cancel: jest.fn(),
      });
      return render(<DetectionPreviewScreen />);
    }

    it.each([
      [StartOutcome.Busy, null, 'settings.previewRefusedBusy'],
      [StartOutcome.Held, 'elevation-running', 'settings.previewSuspended'],
      [StartOutcome.Held, null, 'settings.previewRefusedRecentFailure'],
      [StartOutcome.NotReady, null, 'sections.rescanRefusedNotReady'],
      [StartOutcome.NotOwed, null, 'settings.previewRefusedNothingCovers'],
      [StartOutcome.Failed, null, 'settings.previewRefusedFailed'],
    ])('gives %s under hold %s its own line', (outcome, hold, key) => {
      const { getByTestId } = refusedWith(outcome, hold);

      expect(getByTestId('preview-refusal').props.children).toBe(key);
    });

    it('shows nothing when the start was not refused', () => {
      const { queryByTestId } = refusedWith(null, 'elevation-running');

      expect(queryByTestId('preview-refusal')).toBeNull();
    });
  });
});

/**
 * Scenario: a config change clears the processed set and the re-detect that
 * follows lands after the screen has mounted. The count of activities the
 * catalogue has not seen was read once, keyed on a handle that never changes,
 * so the notice kept saying the catalogue was current, or kept saying it was
 * behind after detection caught up.
 * Expected behaviour: the count is read again when the engine announces that
 * the sections or the activities moved.
 */
describe('the stale catalogue notice', () => {
  const listeners = new Map<string, Set<() => void>>();
  let awaiting = 0;
  const engine = {
    sectionDetectionAwaiting: () => awaiting,
    getSectionConfig: () => null,
    subscribe: (event: string, callback: () => void) => {
      const forEvent = listeners.get(event) ?? new Set<() => void>();
      forEvent.add(callback);
      listeners.set(event, forEvent);
      return () => forEvent.delete(callback);
    },
  };

  function fire(event: string) {
    act(() => {
      listeners.get(event)?.forEach((listener) => listener());
    });
  }

  beforeEach(() => {
    resetEnv();
    mockEnv.stubShell = true;
    listeners.clear();
    awaiting = 0;
    mockEnv.engine = () => engine;
    mockEnv.unifiedConfig = {
      proximityThreshold: 200,
      minSectionLength: 150,
      maxSectionLength: 200000,
      minActivities: 2,
      divergenceThreshold: 0.15,
    };
    mockEnv.centres = { centres: [], labels: {} };
    mockEnv.currentSections = { sections: [], failed: false };
    mockEnv.rescan = () => ({ forceRescan: jest.fn() });
    mockEnv.detect = () => ({
      status: 'idle',
      progress: null,
      result: null,
      refusal: null,
      start: jest.fn(),
      cancel: jest.fn(),
    });
  });

  it.each(['activities', 'sections', 'detectionApplied'])(
    'shows the notice once %s announces activities the catalogue has not seen',
    (event) => {
      const { queryByTestId } = render(<DetectionPreviewScreen />);
      expect(queryByTestId('preview-stale-catalogue')).toBeNull();

      awaiting = 3;
      fire(event);

      expect(queryByTestId('preview-stale-catalogue')).toBeTruthy();
    }
  );

  it('drops the notice once detection has caught up', () => {
    awaiting = 3;
    const { queryByTestId } = render(<DetectionPreviewScreen />);
    expect(queryByTestId('preview-stale-catalogue')).toBeTruthy();

    awaiting = 0;
    fire('detectionApplied');

    expect(queryByTestId('preview-stale-catalogue')).toBeNull();
  });
});

/**
 * Scenario: Keep persists the config and starts a whole-library re-cut, then
 * leaves the screen.
 * Expected behaviour: the re-cut goes through the shared rescan hook, so the
 * poll that feeds every progress indicator starts with the run. Calling the
 * engine client directly leaves the recompute invisible.
 */
describe('keeping a preview starts an observable re-cut', () => {
  const mockBack = router.back as jest.Mock;
  const mockSetSectionConfig = jest.fn();
  const mockClientForceRedetect = jest.fn(() => StartOutcome.Started);
  const mockForceRescan = jest.fn(() => StartOutcome.Started);

  function pressKeepAndConfirm() {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_t, _m, buttons) => {
      buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
    });
    const tree = render(<DetectionPreviewScreen />);
    fireEvent.press(tree.getByTestId('preview-keep-button'));
    alert.mockRestore();
    return tree;
  }

  beforeEach(() => {
    resetEnv();
    mockEnv.engine = () => ({
      sectionDetectionAwaiting: () => 0,
      subscribe: () => () => {},
      getSectionConfig: () => ({
        proximityThreshold: 50,
        minSectionLength: 500,
        maxSectionLength: 20000,
        minActivities: 3,
        divergenceThreshold: 0.2,
      }),
      setSectionConfig: mockSetSectionConfig,
      forceRedetectSections: mockClientForceRedetect,
    });
    mockEnv.unifiedConfig = {
      proximityThreshold: 50,
      minSectionLength: 500,
      maxSectionLength: 20000,
      minActivities: 3,
      divergenceThreshold: 0.2,
    };
    mockEnv.rescan = () => ({
      isScanning: false,
      progress: null,
      result: null,
      failed: false,
      rescan: jest.fn(),
      forceRescan: mockForceRescan,
      clearResult: jest.fn(),
    });
    mockEnv.centres = {
      centres: [{ binKey: 'b1', lat: 1, lng: 2, visitTotal: 10 }],
      labels: ['Home'],
    };
    mockEnv.currentSections = { sections: [], failed: false };
    mockEnv.detect = () => ({
      status: 'idle',
      progress: null,
      result: {
        sections: [],
        counts: { kept: 1, added: 0, removed: 0 },
        config: {
          proximityThreshold: 50,
          minSectionLength: 500,
          maxSectionLength: 20000,
          minActivities: 3,
          divergenceThreshold: 0.2,
        },
      },
      refusal: null,
      start: jest.fn(),
      cancel: jest.fn(),
      reset: jest.fn(),
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    mockForceRescan.mockReturnValue(StartOutcome.Started);
    mockClientForceRedetect.mockReturnValue(StartOutcome.Started);
  });

  it('starts the re-cut through the rescan hook, not the raw client', () => {
    pressKeepAndConfirm();

    expect(mockSetSectionConfig).toHaveBeenCalledTimes(1);
    expect(mockForceRescan).toHaveBeenCalledTimes(1);
    expect(mockClientForceRedetect).not.toHaveBeenCalled();
  });

  it('leaves the screen once the re-cut is running', () => {
    pressKeepAndConfirm();

    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('stays on the screen when the engine refuses the re-cut', () => {
    mockForceRescan.mockReturnValue(StartOutcome.Held);

    pressKeepAndConfirm();

    expect(mockBack).not.toHaveBeenCalled();
  });

  /// Scenario: the cutover is owed, so the flip would reset whatever Keep wrote.
  /// Expected behaviour: Keep is disabled with a notice and writes nothing.
  describe('while the cutover is owed', () => {
    beforeEach(() => {
      mockEnv.cutover = () => true;
    });
    afterEach(() => {
      mockEnv.cutover = () => false;
    });

    it('disables Keep and says it can be kept once the upgrade finishes', () => {
      const tree = render(<DetectionPreviewScreen />);

      expect(tree.getByTestId('preview-keep-button').props.accessibilityState?.disabled).toBe(true);
      expect(tree.getByTestId('preview-keep-after-upgrade')).toBeTruthy();
    });

    it('writes no config when Keep is pressed', () => {
      pressKeepAndConfirm();

      expect(mockSetSectionConfig).not.toHaveBeenCalled();
      expect(mockForceRescan).not.toHaveBeenCalled();
    });
  });

  it('shows no upgrade notice and an enabled Keep once the cutover has run', () => {
    const tree = render(<DetectionPreviewScreen />);

    expect(tree.queryByTestId('preview-keep-after-upgrade')).toBeNull();
    expect(tree.getByTestId('preview-keep-button').props.accessibilityState?.disabled).toBeFalsy();
  });

  it('starts nothing when the preview is discarded', () => {
    const tree = render(<DetectionPreviewScreen />);

    fireEvent.press(tree.getByTestId('preview-discard-button'));

    expect(mockSetSectionConfig).not.toHaveBeenCalled();
    expect(mockForceRescan).not.toHaveBeenCalled();
    expect(mockBack).toHaveBeenCalledTimes(1);
  });
});

/**
 * Scenario: the preview screen puts the picker, the five sliders and the
 * decision row in a vertical ScrollView under the map, so tuning a slider
 * scrolls the map off screen, which is the one thing the screen is for.
 * Expected behaviour: the column does not scroll. The map and every control
 * share one fixed layout, and the diff strip and decision row arrive without
 * pushing either out of the tree. The slider card is the sole exception and
 * scrolls within itself, which is what B179 traded for a floor under each row.
 */
describe('preview screen layout', () => {
  const mockResult: { value: unknown } = { value: null };

  const RESULT_WITH_COUNTS = {
    counts: { unchanged: 3, changed: 1, new: 2, gone: 1 },
    sections: [],
    pool: { activities: 214, empty: 0, unreadable: 0 },
    elapsedMs: 3210,
  };

  // The testID alone, because a failed match on the node prints the whole fiber.
  // Identity rather than a count, so a later regression that scrolls the whole
  // column fails here instead of passing on the card's own ScrollView.
  function onlyVerticalScrollView(tree: ReturnType<typeof render>) {
    const found = tree.UNSAFE_queryAllByType(ScrollView).filter((node) => !node.props.horizontal);
    return found.map((node) => String(node.props.testID));
  }

  beforeEach(() => {
    resetEnv();
    mockEnv.engine = () => ({
      sectionDetectionAwaiting: () => 0,
      subscribe: () => () => {},
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
    });
    mockEnv.unifiedConfig = {
      proximityThreshold: 200,
      minSectionLength: 150,
      maxSectionLength: 200000,
      minActivities: 2,
      divergenceThreshold: 0.15,
    };
    mockEnv.centres = {
      centres: [
        {
          binKey: 'b1',
          lat: 1,
          lng: 2,
          visitTotal: 10,
          sectionCount: 3,
          source: 'visits',
        },
        {
          binKey: 'b2',
          lat: 3,
          lng: 4,
          visitTotal: 6,
          sectionCount: 1,
          source: 'sections',
        },
      ],
      labels: [
        { label: 'Home', fallbackLetter: 'A' },
        { label: 'Coast', fallbackLetter: 'B' },
      ],
    };
    mockEnv.currentSections = { sections: [], failed: false };
    mockEnv.rescan = () => ({ forceRescan: jest.fn(() => true) });
    mockEnv.detect = () => ({
      status: 'idle',
      progress: null,
      result: mockResult.value,
      refusal: null,
      start: jest.fn(),
      cancel: jest.fn(),
      reset: jest.fn(),
    });
    // The picker, the sliders, the diff strip and the run cost are the things
    // that have to fit, so they render for real and only the map surface is
    // stubbed.
    mockEnv.components = {
      PreviewCentrePicker: PreviewCentrePicker,
      PreviewParamPanel: PreviewParamPanel,
      PreviewDiffStrip: PreviewDiffStrip,
      PreviewRunCost: PreviewRunCost,
      PreviewMapView: null,
      PreviewSectionPopover: null,
    };
  });

  afterEach(() => {
    mockResult.value = null;
  });

  it('scrolls the slider card and nothing else, so the map cannot leave the screen', () => {
    const tree = render(<DetectionPreviewScreen />);

    expect(onlyVerticalScrollView(tree)).toEqual(['preview-param-panel']);
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
    // The card is itself the sole vertical ScrollView, pinned above, so
    // nothing under it scrolls on its own.
    expect(panel.findAllByType(ScrollView)).toHaveLength(0);
  });

  it('lets the slider card absorb the leftover height rather than fixing its own', () => {
    const tree = render(<DetectionPreviewScreen />);

    const panel = tree
      .UNSAFE_getAllByType(ScrollView)
      .filter((node) => node.props.testID === 'preview-param-panel')[0];
    const flat = flatten(panel.props.style);
    expect(flat.flex).toBe(1);
    expect(flat.height).toBeUndefined();
    // Without flexGrow on the content the rows cannot expand past the viewport
    // box, and the row floor below does nothing.
    expect(flatten(panel.props.contentContainerStyle).flexGrow).toBe(1);
    for (const slider of panel.findAllByType(Slider)) {
      expect(flatten(slider.parent?.props.style).minHeight).toBe(layout.minTapTarget);
    }
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
    expect(onlyVerticalScrollView(tree)).toEqual(['preview-param-panel']);
  });
});

/**
 * Scenario: the detection preview is the only place the detector's sensitivity
 * can be changed.
 * Expected behaviour: the sliders seed from the persisted config, moving them
 * writes nothing, and only Keep commits the staged values to the engine.
 */
describe('detection preview sensitivity controls', () => {
  const mockSetSectionConfig = jest.fn();
  const mockForceRedetect = jest.fn(() => StartOutcome.Started);
  const mockGetSectionConfig = jest.fn(() => ({
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 50000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  }));

  const mockStart = jest.fn();
  const previewedConfig = {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 50000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  };
  const previewResult = {
    counts: { current: 4, proposed: 6, kept: 3 },
    sections: [],
    config: previewedConfig,
  };
  let mockResult: typeof previewResult | null = previewResult;

  function sliders(tree: ReturnType<typeof render>) {
    return tree.UNSAFE_getAllByType(require('@react-native-community/slider').default);
  }

  function confirmNextAlert() {
    return jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style !== 'cancel')?.onPress?.();
    });
  }

  beforeEach(() => {
    resetEnv();
    mockEnv.engine = () => ({
      sectionDetectionAwaiting: () => 0,
      subscribe: () => () => {},
      getSectionConfig: mockGetSectionConfig,
      setSectionConfig: mockSetSectionConfig,
      forceRedetectSections: mockForceRedetect,
    });
    mockEnv.unifiedConfig = {
      proximityThreshold: 25,
      minSectionLength: 50,
      maxSectionLength: 2000,
      minActivities: 2,
      divergenceThreshold: 0.05,
    };
    mockEnv.detect = () => ({
      status: 'done',
      progress: null,
      result: mockResult,
      refusal: null,
      start: mockStart,
      cancel: jest.fn(),
    });
    mockEnv.centres = {
      centres: [{ binKey: 'home', lat: -37.8, lng: 144.9, count: 12 }],
      labels: { home: 'Home' },
    };
    mockEnv.components = { ...NO_CHILDREN, PreviewParamPanel: PreviewParamPanel };
  });

  beforeEach(() => {
    mockSetSectionConfig.mockClear();
    mockForceRedetect.mockClear();
    mockForceRedetect.mockReturnValue(StartOutcome.Started);
    (router.back as jest.Mock).mockClear();
    mockStart.mockClear();
    mockResult = previewResult;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('seeds every slider from the persisted config', () => {
    const tree = render(<DetectionPreviewScreen />);
    expect(sliders(tree).map((s) => s.props.value)).toEqual([50, 500, 50000, 3, 0.2]);
  });

  it('falls back to the validated defaults when the engine has no config', () => {
    mockGetSectionConfig.mockReturnValueOnce(null as never);
    const tree = render(<DetectionPreviewScreen />);
    expect(sliders(tree).map((s) => s.props.value)).toEqual([25, 50, 2000, 2, 0.05]);
  });

  it('writes nothing to the engine while a slider moves', () => {
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 150);
    fireEvent(sliders(tree)[1], 'valueChange', 900);
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
    expect(mockForceRedetect).not.toHaveBeenCalled();
  });

  it('passes the staged values to a preview run without committing them', () => {
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 150);
    fireEvent(tree.getByTestId('preview-run-button'), 'press');
    expect(mockStart).toHaveBeenCalledWith(
      -37.8,
      144.9,
      expect.objectContaining({ proximityThreshold: 150, minSectionLength: 500 })
    );
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
  });

  it('commits the previewed values only when Keep is confirmed', () => {
    confirmNextAlert();
    mockResult = {
      ...previewResult,
      config: { ...previewedConfig, proximityThreshold: 150, minActivities: 5 },
    };
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 150);
    fireEvent(sliders(tree)[3], 'valueChange', 5);
    fireEvent.press(tree.getByTestId('preview-keep-button'));
    expect(mockSetSectionConfig).toHaveBeenCalledTimes(1);
    expect(mockSetSectionConfig).toHaveBeenCalledWith(
      expect.objectContaining({ proximityThreshold: 150, minActivities: 5 })
    );
    expect(mockForceRedetect).toHaveBeenCalledTimes(1);
  });

  it('disables Keep once a slider moves away from the previewed config', () => {
    confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    expect(tree.getByTestId('preview-keep-button').props.accessibilityState?.disabled).toBeFalsy();
    fireEvent(sliders(tree)[0], 'valueChange', 400);
    expect(tree.getByTestId('preview-keep-button').props.accessibilityState?.disabled).toBe(true);
    fireEvent.press(tree.getByTestId('preview-keep-button'));
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
  });

  it('enables Keep again when the slider returns to the previewed value', () => {
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 400);
    fireEvent(sliders(tree)[0], 'valueChange', 50);
    expect(tree.getByTestId('preview-keep-button').props.accessibilityState?.disabled).toBeFalsy();
  });

  it('leaves the config alone when Keep is cancelled', () => {
    jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((b) => b.style === 'cancel')?.onPress?.();
    });
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(sliders(tree)[0], 'valueChange', 150);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(mockSetSectionConfig).not.toHaveBeenCalled();
    expect(mockForceRedetect).not.toHaveBeenCalled();
  });

  it('closes the screen once the re-cut has actually started', () => {
    confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(mockForceRedetect).toHaveBeenCalledTimes(1);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('stays on the screen when the engine refuses the re-cut', () => {
    // A refusal lands after the config is already persisted and the evidence
    // cache cleared, so closing here would report a change that never ran.
    mockForceRedetect.mockReturnValue(StartOutcome.Held);
    confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(router.back).not.toHaveBeenCalled();
  });

  it('states why the re-cut did not start', () => {
    mockForceRedetect.mockReturnValue(StartOutcome.Held);
    const alert = confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    const [title, message] = alert.mock.calls[alert.mock.calls.length - 1];
    expect(title).toBe('settings.previewKeepRefusedTitle');
    expect(message).toBe('settings.previewKeepRefused sections.rescanRefusedHeld');
  });

  it.each([
    [StartOutcome.Busy, 'sections.rescanRefusedBusy'],
    [StartOutcome.Held, 'sections.rescanRefusedHeld'],
    [StartOutcome.NotReady, 'sections.rescanRefusedNotReady'],
    [StartOutcome.NotConfigured, 'sections.rescanRefusedOff'],
  ])('gives each refusal its own reason (%s)', (outcome, key) => {
    mockForceRedetect.mockReturnValue(outcome);
    const alert = confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    const [, message] = alert.mock.calls[alert.mock.calls.length - 1];
    expect(message).toContain(key);
  });

  it('lets a refused accept be retried without leaving the screen', () => {
    mockForceRedetect.mockReturnValue(StartOutcome.Held);
    confirmNextAlert();
    const tree = render(<DetectionPreviewScreen />);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    mockForceRedetect.mockReturnValue(StartOutcome.Started);
    fireEvent(tree.getByTestId('preview-keep-button'), 'press');
    expect(mockForceRedetect).toHaveBeenCalledTimes(2);
    expect(router.back).toHaveBeenCalledTimes(1);
  });

  it('offers no Keep until a run has produced a result', () => {
    mockResult = null;
    const tree = render(<DetectionPreviewScreen />);
    expect(tree.queryByTestId('preview-keep-button')).toBeNull();
    expect(tree.getByTestId('preview-param-panel')).toBeTruthy();
  });
});

/**
 * Scenario: a preview run reports a percentage the screen throws away, so the
 * athlete watches an indeterminate spinner over a bounded job.
 * Expected behaviour: the run renders a 0-100 bar tracking that percentage,
 * and falls back to the spinner alone when no percentage has arrived yet.
 */
describe('preview run progress', () => {
  const mockProgress: { value: unknown } = { value: null };
  const mockStatus = { value: 'idle' };
  const mockLapsed = { value: false };

  function barWidth(tree: ReturnType<typeof render>) {
    const fill = tree.queryByTestId('preview-progress-fill');
    if (!fill) return null;
    const style = fill.props.style;
    const flat = Array.isArray(style) ? Object.assign({}, ...style.filter(Boolean)) : style;
    return flat.width;
  }

  beforeEach(() => {
    resetEnv();
    mockEnv.engine = () => ({
      sectionDetectionAwaiting: () => 0,
      subscribe: () => () => {},
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
    });
    mockEnv.unifiedConfig = {
      proximityThreshold: 200,
      minSectionLength: 150,
      maxSectionLength: 200000,
      minActivities: 2,
      divergenceThreshold: 0.15,
    };
    mockEnv.centres = {
      centres: [{ binKey: 'b1', lat: 1, lng: 2, visitTotal: 10 }],
      labels: ['Home'],
    };
    mockEnv.currentSections = { sections: [], failed: false };
    mockEnv.detect = () => ({
      status: mockStatus.value,
      progress: mockProgress.value,
      result: null,
      refusal: null,
      lapsed: mockLapsed.value,
      start: jest.fn(),
      cancel: jest.fn(),
      reset: jest.fn(),
    });
  });

  afterEach(() => {
    mockProgress.value = null;
    mockStatus.value = 'idle';
    mockLapsed.value = false;
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

  it('says nothing about a slow run until the run has lapsed', () => {
    mockStatus.value = 'running';

    expect(render(<DetectionPreviewScreen />).queryByTestId('preview-slow')).toBeNull();
  });

  it('tells the athlete a lapsed run is still going', () => {
    mockStatus.value = 'running';
    mockLapsed.value = true;

    expect(render(<DetectionPreviewScreen />).getByTestId('preview-slow')).toBeTruthy();
  });

  it('draws no bar when no run is in flight', () => {
    mockStatus.value = 'idle';

    expect(barWidth(render(<DetectionPreviewScreen />))).toBeNull();
  });
});

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
describe('the preview against a catalogue that has not caught up', () => {
  const mockAwaiting = jest.fn<number | null, []>(() => 0);

  beforeEach(() => {
    resetEnv();
    mockEnv.realI18n = true;
    mockEnv.stubShell = true;
    mockEnv.hold = () => null;
    mockEnv.engine = () => ({
      getSectionConfig: () => null,
      sectionDetectionAwaiting: () => mockAwaiting(),
      subscribe: () => () => {},
    });
    mockEnv.unifiedConfig = {
      proximityThreshold: 200,
      minSectionLength: 150,
      maxSectionLength: 200000,
      minActivities: 2,
      divergenceThreshold: 0.15,
    };
    mockEnv.detect = () => ({
      status: 'idle',
      progress: null,
      result: null,
      refusal: null,
      start: jest.fn(),
      cancel: jest.fn(),
    });
    mockEnv.centres = { centres: [], labels: {} };
    mockEnv.currentSections = { sections: [], failed: false };
    mockEnv.rescan = () => ({ forceRescan: jest.fn() });
  });

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
