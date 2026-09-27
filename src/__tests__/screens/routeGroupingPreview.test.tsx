/**
 * Scenario: the route-grouping preview is the only place the two grouping
 * numbers can be tried, and it must say what they would do to the routes the
 * athlete already has.
 *
 * Expected behaviour: the screen regroups on the value it opens with, repaints
 * the lines it already holds against the answer, says how many routes the
 * setting produces, and applies nothing.
 */

import React from 'react';
import { act, render, screen } from '@testing-library/react-native';
import RouteGroupingPreviewScreen from '@/app/route-grouping-preview';
import { GROUPING_DEFAULTS } from '@/features/routes/lib/groupingParams';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const groups = [
  { groupId: 'g1', representativeId: 'a1', encodedPolyline: new ArrayBuffer(0), bounds: undefined },
  { groupId: 'g2', representativeId: 'a2', encodedPolyline: new ArrayBuffer(0), bounds: undefined },
];

const mockGetRoutesScreenData = jest.fn(() => ({ groups }));
const mockStart = jest.fn(() => true);
let mockPreviewGroups: { key: string; activityIds: string[] }[] | null = null;
let mockPreviewStatus = 'idle';
let mockStrictness: { minMatchPct: number; endpointThreshold: number } | null = null;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getRoutesScreenData: mockGetRoutesScreenData,
    startRouteGroupingPreview: mockStart,
    pollRouteGroupingPreview: () => mockPreviewStatus,
    takeRouteGroupingPreviewResult: () => mockPreviewGroups,
    cancelRouteGroupingPreview: jest.fn(),
    getMatchStrictness: () => mockStrictness,
  }),
}));

jest.mock('@/features/routes/hooks/useRouteGroupingPreview', () => {
  const actual = jest.requireActual('@/features/routes/hooks/useRouteGroupingPreview');
  return {
    ...actual,
    useRouteGroupingPreview: () => ({
      status: mockPreviewStatus,
      groups: mockPreviewGroups,
      refused: false,
      request: mockStart,
      cancel: jest.fn(),
    }),
  };
});

jest.mock('@/features/routes/components', () => ({
  GroupingParamPanel: () => null,
  GroupingPreviewMap: () => null,
}));

jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  ...jest.requireActual('@/shared/app/TopSafeAreaContext'),
  useTopSafeArea: () => ({ hasTopBanner: false, topInset: 0, screenEdges: [] }),
  useScreenSafeAreaEdges: () => [],
}));

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

// The real strings, so the assertions below are about the copy an athlete
// reads rather than about a key.
jest.mock('react-i18next', () => {
  const strings = require('@/i18n/locales/en-GB.json');
  return {
    ...jest.requireActual('react-i18next'),
    useTranslation: () => ({
      t: (key: string, vars?: Record<string, unknown>) => {
        const raw = key
          .split('.')
          .reduce<unknown>((acc, part) => (acc as Record<string, unknown>)?.[part], strings);
        const text = typeof raw === 'string' ? raw : key;
        return vars
          ? text.replace(/{{(\w+)}}/g, (_m, name: string) => String(vars[name] ?? ''))
          : text;
      },
    }),
  };
});

beforeEach(() => {
  jest.clearAllMocks();
  mockPreviewGroups = null;
  mockPreviewStatus = 'idle';
  mockStrictness = null;
});

it('asks for a grouping at the value it opens with, without being dragged', () => {
  render(<RouteGroupingPreviewScreen />);

  expect(mockStart).toHaveBeenCalledWith({ minMatchPercentage: 55, endpointThreshold: 250 });
});

it('says it is working until the first answer lands', () => {
  mockPreviewStatus = 'running';
  render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe('Grouping your rides…');
});

it('counts the routes the setting produces once the answer lands', () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [
    { key: 'p1', activityIds: ['a1', 'a2'] },
    { key: 'p2', activityIds: ['a9'] },
  ];
  render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe('2 routes at this setting');
});

it('says the grouping did not finish rather than that it is still running', () => {
  mockPreviewStatus = 'error';
  render(<RouteGroupingPreviewScreen />);

  expect(screen.getByTestId('grouping-status').props.children).toBe(
    'The grouping did not finish. Move a knob to try again.'
  );
});

it('says nothing was cancelled when a knob change supersedes a run', () => {
  mockPreviewStatus = 'cancelled';
  render(<RouteGroupingPreviewScreen />);

  // A cancel is a knob that moved, and the next run is already being asked
  // for, so the row reads as working rather than as a failure.
  expect(screen.getByTestId('grouping-status').props.children).toBe('Grouping your rides…');
});

it('names the routes a setting would leave on their own', async () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [{ key: 'p1', activityIds: ['a1'] }];
  render(<RouteGroupingPreviewScreen />);
  // The route read waits for the push transition, so the paint is a frame behind.
  await act(async () => {});

  expect(screen.getByTestId('grouping-dropped')).toBeTruthy();
});

it('draws no dropped line when every route keeps a group', () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [
    { key: 'p1', activityIds: ['a1'] },
    { key: 'p2', activityIds: ['a2'] },
  ];
  render(<RouteGroupingPreviewScreen />);

  expect(screen.queryByTestId('grouping-dropped')).toBeNull();
});

it('reads the routes once, and applies nothing', async () => {
  mockPreviewStatus = 'complete';
  mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];
  const engine = jest.requireMock('@/shared/native/engine').getEngine();

  render(<RouteGroupingPreviewScreen />);
  await act(async () => {});

  expect(mockGetRoutesScreenData).toHaveBeenCalledTimes(1);
  expect(engine.setMatchStrictness).toBeUndefined();
});

/**
 * Scenario: the engine holds the strictness in force, and the screen opened on
 * the grouper's defaults because nothing bound the getter. An athlete who had
 * changed the setting saw the panel claim a value that was not applied.
 *
 * Expected behaviour: the knobs open on what the engine answers, and on the
 * defaults only when it answers nothing.
 */
describe('the strictness the screen opens on', () => {
  it('is the one the engine holds', async () => {
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];
    mockStrictness = { minMatchPct: 62, endpointThreshold: 190 };

    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(mockStart).toHaveBeenCalledWith({
      minMatchPercentage: 62,
      endpointThreshold: 190,
    });
  });

  it('is the grouper default when the engine answers nothing', async () => {
    mockPreviewStatus = 'complete';
    mockPreviewGroups = [{ key: 'p1', activityIds: ['a1', 'a2'] }];
    mockStrictness = null;

    render(<RouteGroupingPreviewScreen />);
    await act(async () => {});

    expect(mockStart).toHaveBeenCalledWith(GROUPING_DEFAULTS);
  });
});
