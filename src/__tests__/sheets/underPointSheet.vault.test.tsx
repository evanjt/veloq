/**
 * Scenario: a tap on the heatmap opens a sheet of the activities under it, a
 * formSheet route that answers its caller through the sheet request channel and
 * tells the map which group to draw.
 *
 * Expected behaviour: it lists the routes, the sections and the group of
 * activities in no route with their counts, in the order given, and the chosen group's activities under them; choosing a group reports
 * it to the map, a tapped activity resolves the caller with its id, and the
 * sheet says how many of a group are drawn when the group is over the cap.
 */
import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { FfiUnderPointKind } from 'veloqrs';

import UnderPointSheet, { type UnderPointInput } from '@/app/sheets/under-point';
import { openSheet } from '@/shared/app/sheetRequest';
import { initialiseI18n } from '@/i18n';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    canGoBack: () => true,
    back: () => mockBack(),
  },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const DAY = 86_400;
const BASE_DATE = 1_700_000_000;

const activity = (id: string, name: string, date = BASE_DATE) => ({
  id,
  name,
  sportType: 'Ride',
  date,
  distance: 20_000,
  duration: 3600,
  nearestM: 4,
});

const GROUPS: UnderPointInput['groups'] = [
  {
    kind: FfiUnderPointKind.Route,
    id: 'loop',
    name: 'Lake loop',
    count: 2,
    sportTypes: ['Ride'],
    distanceM: 12_000,
    passes: 7,
    bestTime: 1860,
    lastDate: 1_700_000_000,
    activities: [activity('a', 'Morning spin'), activity('b', 'Evening spin')],
  },
  {
    kind: FfiUnderPointKind.Route,
    id: 'hill',
    number: 4,
    count: 1,
    sportTypes: [],
    distanceM: 0,
    passes: 0,
    activities: [activity('c', 'Hill repeat')],
  },
  {
    kind: FfiUnderPointKind.Section,
    id: 'loop',
    name: 'Lake climb',
    count: 2,
    sportTypes: ['Ride'],
    distanceM: 800,
    passes: 5,
    activities: [activity('a', 'Morning spin'), activity('e', 'Lunch spin')],
  },
  {
    kind: FfiUnderPointKind.Section,
    id: 'quiet',
    count: 1,
    sportTypes: [],
    distanceM: 0,
    passes: 0,
    activities: [activity('f', 'Quiet spin')],
  },
  {
    kind: FfiUnderPointKind.NoRoute,
    count: 3,
    sportTypes: [],
    distanceM: 0,
    passes: 0,
    activities: [activity('d', 'Detour')],
  },
];

async function open(overrides: Partial<UnderPointInput> = {}) {
  const onGroup = jest.fn();
  const input: UnderPointInput = {
    total: 6,
    traceCap: 20,
    groups: GROUPS,
    activities: [],
    onGroup,
    ...overrides,
  };
  const result = openSheet<UnderPointInput, string>('sheets/under-point', input);
  mockParams = { request: mockPush.mock.calls.at(-1)[0].params.request };
  await render(<UnderPointSheet />);
  return { result, onGroup };
}

beforeAll(async () => {
  await initialiseI18n('en-GB');
});
beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
});

describe('under-point sheet', () => {
  it('lists the total and each group with its count, the one-off group last', async () => {
    await open();
    expect(screen.getByRole('header')).toHaveTextContent('6 activities');
    const groups = screen.getAllByTestId(/^under-point-group-/);
    expect(groups.map((g) => g.props.testID)).toEqual([
      'under-point-group-route-loop',
      'under-point-group-route-hill',
      'under-point-group-section-loop',
      'under-point-group-section-quiet',
      'under-point-group-none',
    ]);
    expect(groups[0]).toHaveTextContent(/Lake loop.*2 under the tap/);
    expect(groups[1]).toHaveTextContent(/Route 4.*1 under the tap/);
    expect(groups[4]).toHaveTextContent(/3 under the tap/);
  });

  it('names a section by its own name and an unnamed one as a section, not a route', async () => {
    await open();
    expect(screen.getByTestId('under-point-group-section-loop')).toHaveTextContent(
      /Lake climb.*2 under the tap/
    );
    expect(screen.getByTestId('under-point-group-section-quiet')).toHaveTextContent(
      /Unnamed section.*1 under the tap/
    );
  });

  it('keeps a route and a section of one id as two rows, each choosing its own group', async () => {
    const { onGroup } = await open();
    await fireEvent.press(screen.getByTestId('under-point-group-section-loop'));
    expect(onGroup).toHaveBeenLastCalledWith(GROUPS[2]);
    expect(screen.getByTestId('under-point-group-section-loop')).toBeSelected();
    expect(screen.getByTestId('under-point-group-route-loop')).not.toBeSelected();
    expect(screen.getByTestId('under-point-activity-e')).toBeTruthy();
  });

  it('gives a route the length, passes, best time and last date, a section its visits', async () => {
    await open();
    const route = screen.getByTestId('under-point-group-route-loop');
    expect(route).toHaveTextContent(/12\.0\s*km/);
    expect(route).toHaveTextContent(/7\s+activities/);
    expect(route).toHaveTextContent(/PR\s+31:00/);
    expect(route).toHaveTextContent(/14\s+Nov/);
    const section = screen.getByTestId('under-point-group-section-loop');
    expect(section).toHaveTextContent(/800\s*m/);
    expect(section).toHaveTextContent(/5\s+traversals/);
    expect(section).not.toHaveTextContent('PR');
  });

  it('gives the group in no route its count only', async () => {
    await open();
    const none = screen.getByTestId('under-point-group-none');
    expect(none).toHaveTextContent(/3\s+under the tap/);
    expect(none).not.toHaveTextContent('km');
    expect(screen.queryByTestId('under-point-open-none')).toBeNull();
  });

  it('opens the page of a route or a section without choosing its group', async () => {
    const { onGroup, result } = await open();
    const routePage = screen.getByTestId('under-point-open-route-hill');
    const glyphs = routePage.findAll((node) => typeof node.props.name === 'string');
    expect(glyphs.length).toBeGreaterThan(0);
    expect(glyphs.map((node) => node.props.name)).not.toContain('open-in-new');
    onGroup.mockClear();
    await fireEvent.press(screen.getByTestId('under-point-open-section-quiet'));
    expect(mockPush).toHaveBeenLastCalledWith('/section/quiet');
    expect(onGroup).toHaveBeenLastCalledWith(null);
    await fireEvent.press(screen.getByTestId('under-point-open-route-hill'));
    expect(mockPush).toHaveBeenLastCalledWith('/route/hill');
    expect(mockBack).toHaveBeenCalledTimes(2);
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('selects the first group on open when everything fits under the cap', async () => {
    const { onGroup } = await open();
    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(onGroup).toHaveBeenCalledWith(GROUPS[0]);
    expect(screen.getByTestId('under-point-activity-a')).toBeTruthy();
    expect(screen.queryByTestId('under-point-activity-c')).toBeNull();
  });

  it('selects nothing on open when the total is over the cap', async () => {
    const { onGroup } = await open({ total: 30, traceCap: 20 });
    expect(onGroup).not.toHaveBeenCalled();
    expect(screen.queryByTestId('under-point-activity-a')).toBeNull();
  });

  it('reports the group chosen and lists its activities', async () => {
    const { onGroup } = await open();
    await fireEvent.press(screen.getByTestId('under-point-group-route-hill'));
    expect(onGroup).toHaveBeenLastCalledWith(GROUPS[1]);
    expect(screen.getByTestId('under-point-activity-c')).toBeTruthy();
    expect(screen.queryByTestId('under-point-activity-a')).toBeNull();
    expect(screen.getByTestId('under-point-group-route-hill')).toBeSelected();
    expect(screen.getByTestId('under-point-group-route-loop')).not.toBeSelected();
  });

  it('says how many of a group are drawn when the group is over the cap', async () => {
    await open({ total: 30, traceCap: 1 });
    await fireEvent.press(screen.getByTestId('under-point-group-route-loop'));
    expect(screen.getByTestId('under-point-drawn')).toHaveTextContent('1 of 2 drawn');
  });

  it('says nothing about drawing when the group fits under the cap', async () => {
    await open();
    expect(screen.queryByTestId('under-point-drawn')).toBeNull();
  });

  it('resolves the caller with the id of the tapped activity', async () => {
    const { result } = await open();
    await fireEvent.press(screen.getByTestId('under-point-activity-b'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'b' });
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('resolves cancelled from its Cancel', async () => {
    const { result } = await open();
    await fireEvent.press(screen.getByTestId('under-point-cancel'));
    expect(mockBack).toHaveBeenCalledTimes(1);
    await screen.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });
});

/**
 * Two route groups, one section group and five activities, one of them in a
 * route and a section at once. Each listed activity has its own date, so the
 * newest-first order is the one under test.
 */
const FILTER_GROUPS: UnderPointInput['groups'] = [
  {
    kind: FfiUnderPointKind.Route,
    id: 'loop',
    name: 'Lake loop',
    count: 2,
    sportTypes: ['Ride'],
    distanceM: 12_000,
    passes: 7,
    activities: [
      activity('a', 'Morning spin', BASE_DATE + 4 * DAY),
      activity('b', 'Evening spin', BASE_DATE + DAY),
    ],
  },
  {
    kind: FfiUnderPointKind.Route,
    id: 'hill',
    number: 4,
    count: 2,
    sportTypes: ['Ride'],
    distanceM: 0,
    passes: 0,
    activities: [
      activity('c', 'Hill repeat', BASE_DATE + 2 * DAY),
      activity('d', 'Detour', BASE_DATE),
    ],
  },
  {
    kind: FfiUnderPointKind.Section,
    id: 'loop',
    name: 'Lake climb',
    count: 2,
    sportTypes: ['Ride'],
    distanceM: 800,
    passes: 5,
    activities: [
      activity('a', 'Morning spin', BASE_DATE + 4 * DAY),
      activity('e', 'Lunch spin', BASE_DATE + 3 * DAY),
    ],
  },
];

/** The engine's list: each activity once, newest first. */
const FILTER_ACTIVITIES: UnderPointInput['activities'] = [
  activity('a', 'Morning spin', BASE_DATE + 4 * DAY),
  activity('e', 'Lunch spin', BASE_DATE + 3 * DAY),
  activity('c', 'Hill repeat', BASE_DATE + 2 * DAY),
  activity('b', 'Evening spin', BASE_DATE + DAY),
  activity('d', 'Detour', BASE_DATE),
];

const FILTER_ANSWER = { total: 5, groups: FILTER_GROUPS, activities: FILTER_ACTIVITIES };

const ROUTES_ONLY: UnderPointInput['groups'] = [FILTER_GROUPS[0]];

const activityIds = () =>
  screen.queryAllByTestId(/^under-point-activity-/).map((row) => row.props.testID);
const groupIds = () =>
  screen.queryAllByTestId(/^under-point-group-/).map((row) => row.props.testID);

describe('under-point sheet kind filter', () => {
  it('offers All, Routes, Sections and Activities, each kind with its count', async () => {
    await open(FILTER_ANSWER);
    expect(screen.getByTestId('under-point-filter-routes')).toHaveTextContent(/Routes.*2/);
    expect(screen.getByTestId('under-point-filter-sections')).toHaveTextContent(/Sections.*1/);
    expect(screen.getByTestId('under-point-filter-activities')).toHaveTextContent(/Activities.*5/);
    expect(screen.getByTestId('under-point-filter-all')).toHaveTextContent(/All.*5/);
    expect(screen.getByTestId('under-point-filter-all')).toBeSelected();
  });

  it('draws no filter row when the answer holds routes only', async () => {
    await open({ total: 2, groups: ROUTES_ONLY });
    expect(screen.queryByTestId('under-point-filter')).toBeNull();
    expect(groupIds()).toEqual(['under-point-group-route-loop']);
  });

  it('draws the row for a route and the activities in no route, without a Sections segment', async () => {
    const loose: UnderPointInput['groups'][number] = {
      kind: FfiUnderPointKind.NoRoute,
      count: 1,
      sportTypes: [],
      distanceM: 0,
      passes: 0,
      activities: [activity('d', 'Detour', BASE_DATE)],
    };
    await open({
      total: 3,
      groups: [FILTER_GROUPS[0], loose],
      activities: [
        activity('a', 'Morning spin', BASE_DATE + 4 * DAY),
        activity('b', 'Evening spin', BASE_DATE + DAY),
        activity('d', 'Detour', BASE_DATE),
      ],
    });
    expect(screen.getByTestId('under-point-filter-routes')).toHaveTextContent(/Routes.*1/);
    expect(screen.getByTestId('under-point-filter-activities')).toHaveTextContent(/Activities.*3/);
    expect(screen.queryByTestId('under-point-filter-sections')).toBeNull();
  });

  it('lists the route groups only under Routes, with the chosen group activities', async () => {
    await open(FILTER_ANSWER);
    await fireEvent.press(screen.getByTestId('under-point-filter-routes'));
    expect(groupIds()).toEqual(['under-point-group-route-loop', 'under-point-group-route-hill']);
    expect(activityIds()).toEqual(['under-point-activity-a', 'under-point-activity-b']);
    expect(screen.getByTestId('under-point-filter-routes')).toBeSelected();
  });

  it('lists the section groups only under Sections, and keeps the chosen group drawn', async () => {
    const { onGroup } = await open(FILTER_ANSWER);
    await fireEvent.press(screen.getByTestId('under-point-filter-sections'));
    expect(groupIds()).toEqual(['under-point-group-section-loop']);
    expect(activityIds()).toEqual([]);
    expect(onGroup).toHaveBeenCalledTimes(1);
    expect(onGroup).toHaveBeenCalledWith(FILTER_GROUPS[0]);
  });

  it('lists every activity once, newest first, with no group rows under Activities', async () => {
    const { onGroup } = await open(FILTER_ANSWER);
    await fireEvent.press(screen.getByTestId('under-point-filter-activities'));
    expect(groupIds()).toEqual([]);
    expect(activityIds()).toEqual([
      'under-point-activity-a',
      'under-point-activity-e',
      'under-point-activity-c',
      'under-point-activity-b',
      'under-point-activity-d',
    ]);
    expect(onGroup).toHaveBeenCalledTimes(1);
  });

  it('returns to the grouped list under All', async () => {
    await open(FILTER_ANSWER);
    await fireEvent.press(screen.getByTestId('under-point-filter-activities'));
    await fireEvent.press(screen.getByTestId('under-point-filter-all'));
    expect(groupIds()).toHaveLength(3);
    expect(activityIds()).toEqual(['under-point-activity-a', 'under-point-activity-b']);
  });
});
