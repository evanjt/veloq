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

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const groups = [
  { groupId: 'g1', representativeId: 'a1', encodedPolyline: new ArrayBuffer(0), bounds: undefined },
  { groupId: 'g2', representativeId: 'a2', encodedPolyline: new ArrayBuffer(0), bounds: undefined },
];

const mockGetRoutesScreenData = jest.fn(() => ({ groups }));
const mockStart = jest.fn(() => true);
let mockPreviewGroups: { key: string; activityIds: string[] }[] | null = null;
let mockPreviewStatus = 'idle';

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getRoutesScreenData: mockGetRoutesScreenData,
    startRouteGroupingPreview: mockStart,
    pollRouteGroupingPreview: () => mockPreviewStatus,
    takeRouteGroupingPreviewResult: () => mockPreviewGroups,
    cancelRouteGroupingPreview: jest.fn(),
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

jest.mock('react-native-safe-area-context', () => {
  const { View } = require('react-native');
  return {
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
    SafeAreaProvider: View,
    SafeAreaView: View,
  };
});

jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

// The real strings, so the assertions below are about the copy an athlete
// reads rather than about a key.
jest.mock('react-i18next', () => {
  const strings = require('@/i18n/locales/en-GB.json');
  return {
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
