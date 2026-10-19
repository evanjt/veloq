/**
 * Scenario: one demo route ridden many times, and a section drawn along it
 * whose traversals are the route's attempts, so the section page and the
 * route page describe the same efforts from one performance read.
 *
 * Expected behaviour: every element the two pages share is on both, found by
 * its testID, and every element the section page keeps to itself is on the
 * section page and not on the route page. The table below is the record of
 * which is which.
 */

import React from 'react';
import { StyleSheet } from 'react-native';
import { act, fireEvent, render, screen, within } from '@testing-library/react-native';
import { PaperProvider } from 'react-native-paper';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EfficiencyDirection, FfiOffScale } from 'veloqrs';
import type { FfiCalendarSummary, FfiSectionChartPoint, FfiSectionPerformanceData } from 'veloqrs';
import { sectionCardInHost } from '../__shared__/sectionCardInHost';
import { routeCardInHost } from '../__shared__/routeCardInHost';

import { fixtures } from '@/data/demo/fixtures';
import { getRouteCoordinates } from '@/shared/demo/routes/routes';
import { Button, paint } from '@/shared/ui/Button';
import { ChromeIcon } from '@/shared/ui/ChromeIcon';
import { useMapSheetStops } from '@/shared/app/mapSheetStop';
import { useDebugStore } from '@/features/settings/light';

const DEMO_ROUTE = 'route-valais-ride-2';

const RouteDetailScreen = routeCardInHost();
const SectionDetailScreen = sectionCardInHost();

jest.mock('veloqrs', () =>
  require('../__shared__/veloqrsStub').withOverrides({
    ...require('../__shared__/veloqrsStub').namespacesOver(() =>
      require('@/shared/native/engine').getEngine()
    ),
    FfiCorrelation_Tags: {
      TooFew: 'TooFew',
      Undefined: 'Undefined',
      Inconclusive: 'Inconclusive',
      Mover: 'Mover',
    },
    // The section's polyline and the route's representative are the same line.
    decodeCoords: () =>
      mockLineless
        ? []
        : (
            jest
              .requireActual('@/shared/demo/routes/routes')
              .getRouteCoordinates('route-valais-ride-2') as [number, number][]
          ).map(([latitude, longitude]) => ({ latitude, longitude })),
  })
);
let mockLineless = false;
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

let mockPageId = '';
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useIsFocused: () => true,
  Stack: Object.assign(() => null, { Screen: () => null }),
  useLocalSearchParams: () => ({ id: mockPageId }),
  useFocusEffect: () => {},
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
}));
jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock('@/shared/app/useCacheDays', () => ({ useCacheDays: () => 90 }));
jest.mock('@/shared/debug/renderTimer', () => ({
  logScreenRender: () => () => {},
  recordAppMetric: () => {},
}));
jest.mock('@/shared/debug/useFFITimer', () => ({
  useFFITimer: () => ({ getPageMetrics: () => [] }),
}));
// The section map waits for the navigation transition; it is not under test.
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: () => {},
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (component: unknown) => component,
}));
jest.mock('@/features/settings', () => ({
  useDebugStore: (select: (state: { enabled: boolean }) => unknown) => select({ enabled: false }),
  useGpxExport: () => ({ exportGpx: jest.fn(), exporting: false }),
}));
jest.mock('@/features/routes/components/RouteDetailMap', () => ({ RouteDetailMap: () => null }));

type DemoAttempt = (typeof fixtures.activities)[number] & { _routeId: string | null };

const attempts = (fixtures.activities as DemoAttempt[])
  .filter((activity) => activity._routeId === DEMO_ROUTE)
  .map((activity) => ({
    id: activity.id,
    name: activity.name,
    date: Date.parse(`${activity.start_date_local}Z`) / 1000,
    time: activity.moving_time,
    distance: activity.distance,
    avgHr: activity.average_heartrate,
  }))
  .sort((a, b) => a.date - b.date);

const best = attempts.reduce((a, b) => (b.time < a.time ? b : a));
const routeLengthM = Math.round(attempts.reduce((sum, a) => sum + a.distance, 0) / attempts.length);
const routeLine = getRouteCoordinates(DEMO_ROUTE);

const chartPoints: FfiSectionChartPoint[] = attempts.map((a) => ({
  lapId: a.id,
  activityId: a.id,
  activityName: a.name,
  activityDate: a.date,
  speed: a.distance / a.time,
  sectionTime: a.time,
  sectionDistance: a.distance,
  direction: 'same',
  isBest: a.id === best.id,
  outsideDistanceBand: false,
  offScale: FfiOffScale.None,
}));

function calendarOf(): FfiCalendarSummary {
  const bestOf = (group: typeof attempts) => {
    const fastest = group.reduce((a, b) => (b.time < a.time ? b : a));
    return {
      count: group.length,
      bestTime: fastest.time,
      bestPace: fastest.distance / fastest.time,
      bestActivityId: fastest.id,
      bestActivityName: fastest.name,
    };
  };
  const years = new Map<number, typeof attempts>();
  for (const a of attempts) {
    const year = new Date(a.date * 1000).getUTCFullYear();
    years.set(year, [...(years.get(year) ?? []), a]);
  }
  return {
    years: [...years].map(([year, inYear]) => {
      const months = new Map<number, typeof attempts>();
      for (const a of inYear) {
        const month = new Date(a.date * 1000).getUTCMonth() + 1;
        months.set(month, [...(months.get(month) ?? []), a]);
      }
      return {
        year,
        traversalCount: inYear.length,
        activityCount: inYear.length,
        forward: bestOf(inYear),
        months: [...months].map(([month, inMonth]) => ({
          month,
          traversalCount: inMonth.length,
          activityCount: inMonth.length,
          forward: bestOf(inMonth),
        })),
      };
    }),
    forwardPr: bestOf(attempts),
    sectionDistance: routeLengthM,
  };
}

const BIN_SECS = 300;
const binStart = Math.floor(Math.min(...attempts.map((a) => a.time)) / BIN_SECS) * BIN_SECS;
const binCounts = attempts.reduce<number[]>((counts, a) => {
  const bin = Math.floor((a.time - binStart) / BIN_SECS);
  counts[bin] = (counts[bin] ?? 0) + 1;
  return counts;
}, []);

const withHr = attempts.filter((a) => a.avgHr != null);

/** The one read both pages draw, over the demo route's rides. */
const demoRead: FfiSectionPerformanceData = {
  sportType: 'Ride',
  sportCounts: [{ sportType: 'Ride', count: attempts.length }],
  calendarSummary: calendarOf(),
  performances: { records: [], bestForwardIsPr: false, bestReverseIsPr: false },
  chartData: {
    points: chartPoints,
    minSpeed: Math.min(...chartPoints.map((p) => p.speed)),
    maxSpeed: Math.max(...chartPoints.map((p) => p.speed)),
    hasReverseRuns: false,
    bestTimeSecs: best.time,
    firstActivityDate: attempts[0].date,
    lastActivityDate: attempts[attempts.length - 1].date,
    totalActivities: attempts.length,
  },
  excludedPoints: [],
  lapRecords: [],
  bestForwardIsRecord: true,
  bestReverseIsRecord: false,
  trendCurves: {},
  histograms: {
    forward: {
      startSecs: binStart,
      binWidthSecs: BIN_SECS,
      counts: Array.from(binCounts, (count) => count ?? 0),
      binned: attempts.length,
      unbinnedOutsideBand: 0,
    },
  },
  correlations: [
    {
      direction: 'same',
      variable: 'sleep',
      result: { tag: 'TooFew', inner: { n: 2 } },
      familySize: 0,
    } as unknown as FfiSectionPerformanceData['correlations'][number],
  ],
  correlationFloor: 8,
  curves: {
    gridStepM: 10,
    splitStepM: 100,
    sectionLengthM: routeLengthM,
    forward: {
      referenceActivityId: best.id,
      referenceSource: 0 as never,
      defaultReference: 0 as never,
      laps: attempts.slice(-2).map((a) => ({
        activityId: a.id,
        startIndex: 0,
        activityDate: a.date,
        deltaSecs: Float32Array.from([0, a.time - best.time]),
        splitDeltaSecs: Float32Array.from([a.time - best.time]),
        splitSecs: Float32Array.from([a.time]),
        endDeltaSecs: a.time - best.time,
      })),
      missing: [],
      peakDeltaSecs: Math.max(...attempts.slice(-2).map((a) => Math.abs(a.time - best.time))),
      // With no attempt chosen the delta plot is the typical attempt's, so it is offered only
      // where the engine gives one.
      splitSummary: {
        medianSecs: Float32Array.from([attempts[attempts.length - 1]!.time - best.time]),
        lowerQuartileSecs: Float32Array.from([NaN]),
        upperQuartileSecs: Float32Array.from([NaN]),
        laps: [5],
      },
    },
  },
  curvesPending: false,
  efficiencyTrend: {
    sectionId: 'demo',
    sectionName: 'Valais',
    sportType: 'Ride',
    points: withHr.map((a) => {
      const paceSecsPerKm = a.time / (a.distance / 1000);
      return {
        date: a.date,
        paceSecsPerKm,
        avgHr: a.avgHr ?? 0,
        hrPaceRatio: (a.avgHr ?? 0) / paceSecsPerKm,
      };
    }),
    trendSlope: -1,
    direction: EfficiencyDirection.Improving,
    hrChangeBpm: -2,
    effortCount: withHr.length,
  },
  scatterFocus: {
    forward: {
      low: Math.min(...chartPoints.map((p) => p.speed)),
      high: Math.max(...chartPoints.map((p) => p.speed)),
      slowCount: 0,
      fastCount: 0,
    },
  },
  recordProgression: { forward: [], reverse: [] },
};

/** One ride crossed the section twice, which only a section can hold. */
const twice = attempts[attempts.length - 1];
const lap = (n: number) => ({
  id: `${twice.id}-lap-${n}`,
  activityId: twice.id,
  time: twice.time,
  pace: twice.distance / twice.time,
  distance: twice.distance,
  direction: 'same',
  startIndex: 0,
  endIndex: 1,
  excluded: false,
  outsideDistanceBand: false,
  isRecord: false,
});
const sectionRead: FfiSectionPerformanceData = {
  ...demoRead,
  lapRecords: [
    {
      activityId: twice.id,
      activityName: twice.name,
      activityDate: twice.date,
      laps: [lap(1), lap(2)],
      lapCount: 2,
      bestTime: twice.time,
      bestPace: twice.distance / twice.time,
      avgTime: twice.time,
      avgPace: twice.distance / twice.time,
      direction: 'same',
      sectionDistance: twice.distance,
    },
  ],
};

const SECTION_ID = 'sec-valais';
const GROUP_ID = 'grp-valais';
const activityIds = attempts.map((a) => a.id);

const mockEngine = {
  subscribe: () => () => {},
  getSectionDetailData: jest.fn(() => ({
    activityCount: attempts.length,
    section: {
      id: SECTION_ID,
      sectionType: 'auto',
      name: 'Valais climb',
      sportTypes: ['Ride'],
      encodedPolyline: new ArrayBuffer(0),
      distanceMeters: routeLengthM,
      activityIds,
      activityPortions: attempts.map((a) => ({
        activityId: a.id,
        startIndex: 0,
        endIndex: routeLine.length - 1,
        distanceMeters: a.distance,
        direction: 'same',
      })),
      visitCount: attempts.length,
      isUserDefined: false,
      createdAt: '2026-01-01T00:00:00Z',
      // A climb, so its grades are drawn in the summary.
      klass: 'climb',
      elevationGainM: 640,
      elevationLossM: 20,
      avgGradePercent: 5.2,
      maxGradePercent: 9.8,
      // Flagged and removed, so the section-only banners and badge are drawn.
      disabled: true,
      isLift: true,
    },
    mergeCandidates: [
      {
        sectionId: 'sec-valais-twin',
        sportTypes: ['Ride'],
        distanceMeters: routeLengthM,
        visitCount: 3,
        overlapPct: 90,
        centerDistanceMeters: 20,
      },
    ],
    excludedActivityIds: [],
    hasOriginalBounds: false,
    activityRows: [],
    mapSignatures: [],
    missingTimeStreamIds: [],
    history: [{ id: 1, at: '2026-01-01T00:00:00Z', kind: 'created' }],
    geometryVersions: [],
  })),
  getSectionDetailPerformance: jest.fn(() => sectionRead),
  getExcludedActivityIds: jest.fn(() => []),
  getRouteDetailData: jest.fn(() => ({
    activityCount: attempts.length,
    group: {
      groupId: GROUP_ID,
      representativeId: best.id,
      activityIds,
      customName: 'Valais ride',
    },
    distanceMeters: routeLengthM,
    elevationGainMeters: 640,
    encodedRepresentative: new ArrayBuffer(0),
    excludedActivityIds: [],
    mapSignatures: [],
    missingTimeStreamIds: [],
  })),
  getRouteDetailPerformance: jest.fn(() => demoRead),
  excludeActivityFromRoute: jest.fn(),
  includeActivityInRoute: jest.fn(),
  setRouteRepresentative: jest.fn(),
  resetRouteRepresentative: jest.fn(),
};

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
  isEngineReady: () => true,
}));

interface SharedElement {
  element: string;
  section: string;
  route: string;
}

/** Every element the route page carries over from the section page. */
const SHARED: SharedElement[] = [
  { element: 'hero stats row', section: 'section-detail-stats', route: 'route-detail-stats' },
  {
    element: 'performance controls',
    section: 'performance-controls',
    route: 'performance-controls',
  },
  { element: 'sport pills', section: 'sport-pill-Ride', route: 'sport-pill-Ride' },
  { element: 'range menu', section: 'section-time-range', route: 'section-time-range' },
  { element: 'scatter plot choice', section: 'chart-plot-scatter', route: 'chart-plot-scatter' },
  {
    element: 'histogram plot choice',
    section: 'chart-plot-histogram',
    route: 'chart-plot-histogram',
  },
  { element: 'delta plot choice', section: 'chart-plot-delta', route: 'chart-plot-delta' },
  { element: 'info card first', section: 'section-first', route: 'section-first' },
  { element: 'info card last', section: 'section-last', route: 'section-last' },
  {
    element: 'efficiency card',
    section: 'section-efficiency-card',
    route: 'section-efficiency-card',
  },
  {
    element: 'correlation card',
    section: 'section-correlation-card',
    route: 'section-correlation-card',
  },
  { element: 'calendar', section: 'section-calendar', route: 'section-calendar' },
  { element: 'GPX export', section: 'section-export-gpx', route: 'route-export-gpx' },
  { element: 'data range footer', section: 'data-range-footer', route: 'data-range-footer' },
];

interface SectionOnlyElement {
  element: string;
  section: string;
}

/** Elements that describe a section and not a whole route. */
const SECTION_ONLY: SectionOnlyElement[] = [
  { element: 'accept', section: 'section-accept-button' },
  { element: 'grades', section: 'section-detail-grades' },
  { element: 'lift badge', section: 'section-lift-badge' },
  { element: 'disabled banner', section: 'section-disabled-banner' },
  { element: 'merge banner', section: 'section-merge-banner' },
  { element: 'laps link', section: 'section-open-laps' },
  { element: 'history link', section: 'section-open-history' },
];

async function openPage(page: 'section' | 'route') {
  mockPageId = page === 'section' ? SECTION_ID : GROUP_ID;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const screen = await render(
    <QueryClientProvider client={client}>
      {page === 'section' ? <SectionDetailScreen /> : <RouteDetailScreen />}
    </QueryClientProvider>
  );
  // The section page reads its lap times once the stream check settles.
  await act(async () => {});
  return screen;
}

describe('the section page and the route page over one demo route', () => {
  // The efficiency card is experimental, drawn only with the developer switch on.
  beforeEach(() => useDebugStore.setState({ enabled: true, unlocked: true }));
  afterEach(() => useDebugStore.setState({ enabled: false, unlocked: false }));

  it('dates the first and last attempt the same on both pages', async () => {
    expect(attempts.length).toBeGreaterThan(2);

    const sectionPage = await openPage('section');
    const sectionDates = ['section-first', 'section-last'].map(
      (id) => sectionPage.getByTestId(id).props.children
    );
    await sectionPage.unmount();
    const routePage = await openPage('route');
    const routeDates = ['section-first', 'section-last'].map(
      (id) => routePage.getByTestId(id).props.children
    );

    expect(routeDates).toEqual(sectionDates);
    expect(sectionDates[0]).not.toEqual(sectionDates[1]);
  });

  it.each(SHARED)('finds the $element on both pages', async ({ section, route }) => {
    const sectionPage = await openPage('section');
    expect(sectionPage.queryByTestId(section)).not.toBeNull();
    await sectionPage.unmount();

    const routePage = await openPage('route');
    expect(routePage.queryByTestId(route)).not.toBeNull();
  });

  it('draws the GPX export as a share on both pages, since it opens the share sheet', async () => {
    const glyphs = (page: Awaited<ReturnType<typeof openPage>>, id: string) =>
      page
        .getByTestId(id)
        .findAll((n) => n.type === ChromeIcon)
        .map((n) => n.props.name);

    const sectionPage = await openPage('section');
    expect(glyphs(sectionPage, 'section-export-gpx')).toEqual(['share']);
    await sectionPage.unmount();

    const routePage = await openPage('route');
    expect(glyphs(routePage, 'route-export-gpx')).toEqual(['share']);
  });

  it('draws the GPX export as a secondary action with no shadow on both pages', async () => {
    const expectSecondary = (page: Awaited<ReturnType<typeof openPage>>, id: string) => {
      const exportButton = page.UNSAFE_getAllByType(Button).find((n) => n.props.testID === id)!;
      expect(exportButton.props.variant).toBe('secondary');
      const flat = StyleSheet.flatten(exportButton.props.style) ?? {};
      expect(flat).not.toHaveProperty('elevation');
      expect(flat).not.toHaveProperty('shadowOpacity');
      expect(exportButton.findByType(ChromeIcon).props.color).toBe(paint('secondary', false).color);
    };

    const sectionPage = await openPage('section');
    expectSecondary(sectionPage, 'section-export-gpx');
    await sectionPage.unmount();

    const routePage = await openPage('route');
    expectSecondary(routePage, 'route-export-gpx');
  });

  it.each(SECTION_ONLY)('finds the $element on the section page alone', async ({ section }) => {
    const sectionPage = await openPage('section');
    expect(sectionPage.queryByTestId(section)).not.toBeNull();
    await sectionPage.unmount();

    const routePage = await openPage('route');
    expect(routePage.queryByTestId(section)).toBeNull();
  });
});

let headerOptions: { headerRight?: () => React.ReactElement | null } = {};
const SectionWithHeader = sectionCardInHost((next) => {
  headerOptions = next;
});

/** The section's card, then its header's overflow menu, drawn as the host draws it. */
async function openSectionWithHeader() {
  mockPageId = SECTION_ID;
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await render(
    <QueryClientProvider client={client}>
      <SectionWithHeader />
    </QueryClientProvider>
  );
  await act(async () => {});
  await render(<PaperProvider>{headerOptions.headerRight?.()}</PaperProvider>);
}

/** Opens the menu, letting its popup lay itself out first, as a running app does. */
async function menuRows() {
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  await fireEvent.press(screen.getByTestId('section-overflow-menu'));
  await act(async () => {
    jest.advanceTimersByTime(400);
  });
  return screen.getAllByRole('menuitem').map((row) => row.props.accessibilityLabel as string);
}

/**
 * Scenario: at Half the sheet's header rows, a row holding one button, the sport chips and a
 * heading pushed the performance plot below the sheet's edge.
 *
 * Expected behaviour: the climbing joins the stats line, Edit bounds is in the overflow menu,
 * Accept sits in the Peek, the sport chips and the range share one row above the chart with no
 * heading, and the direction's figures sit under the plot.
 */
describe("a section sheet's rows above the chart", () => {
  beforeEach(() => {
    mockLineless = false;
    useMapSheetStops.setState({ sheets: {}, presenters: {} });
  });
  afterEach(() => jest.useRealTimers());

  it('draws no action row and no separate climbing row', async () => {
    const page = await openPage('section');

    expect(page.queryByTestId('section-action-row')).toBeNull();
    expect(page.queryByTestId('section-detail-climb')).toBeNull();
  });

  it('lists Edit bounds first in the overflow menu, and choosing it enters the tool', async () => {
    jest.useFakeTimers();
    await openSectionWithHeader();

    const rows = await menuRows();
    expect(rows[0]).toBe('sections.editBounds');

    await fireEvent.press(screen.getByRole('menuitem', { name: 'sections.editBounds' }));
    const sheets = Object.values(useMapSheetStops.getState().sheets);
    expect(sheets.some((sheet) => sheet.toolReturn !== null)).toBe(true);
  });

  it('lists no Edit bounds for a section with no line', async () => {
    mockLineless = true;
    jest.useFakeTimers();
    await openSectionWithHeader();

    expect(await menuRows()).not.toContain('sections.editBounds');
  });

  it('offers Accept inside the Peek while the section is offered', async () => {
    const page = await openPage('section');

    const accept = within(page.getByTestId('section-card-peek')).getByRole('button', {
      name: 'sections.acceptSection',
    });
    expect(accept).toHaveTextContent('sections.acceptSection');
    const glyph = accept.findAll((n) => typeof n.props.name === 'string')[0]?.props.name;
    expect(glyph).not.toMatch(/^pin/);
    expect(glyph).not.toBe('check-circle');
  });

  it('states the climbing on the stats line', async () => {
    const page = await openPage('section');

    expect(page.getByTestId('section-detail-stats')).toHaveTextContent(/2,100 ft/);
  });

  it('puts the sport chips and the range in one row above the chart, with no heading', async () => {
    const page = await openPage('section');
    const controls = page.getByTestId('performance-controls');

    expect(within(controls).queryByTestId('sport-pill-Ride')).not.toBeNull();
    expect(within(controls).queryByTestId('section-time-range')).not.toBeNull();
    expect(page.queryByText('sections.performanceOverTime')).toBeNull();
  });

  it("draws the direction's figures under the plot", async () => {
    const page = await openPage('section');
    const order = page.UNSAFE_root.findAll(
      (node) =>
        typeof node.type === 'string' &&
        ['section-scatter-chart', 'stats-row-count-forward'].includes(node.props.testID)
    ).map((node) => node.props.testID as string);

    expect(order[0]).toBe('section-scatter-chart');
    expect(order).toContain('stats-row-count-forward');
  });
});

describe("a route sheet's rows above the chart", () => {
  it('puts the sport chips and the range in one row above the chart', async () => {
    const page = await openPage('route');
    const controls = page.getByTestId('performance-controls');

    expect(within(controls).queryByTestId('sport-pill-Ride')).not.toBeNull();
    expect(within(controls).queryByTestId('section-time-range')).not.toBeNull();
  });
});
