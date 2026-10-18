/**
 * Scenario: a chart scrub on the route card writes the scrubbed attempt for the map under the
 * sheet to draw, and every new index committed the whole screen while the state sat in its root.
 *
 * Expected behaviour: the scrub is the card's state in the host's entry. A new index renders the
 * map that draws it and nothing above it, and a clear hands the map nothing again. On a phone the
 * route is fitted above the sheet's settled stop; on a tablet beside the side panel.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';

import { RouteDetailMap } from '@/features/routes/components/RouteDetailMap';
import { detailCardWriter } from '@/features/routes/lib/detailCardState';
import { closeHost, openHost } from '@/shared/app/mapSheetHost';

const mockMapProps = jest.fn();

jest.mock('veloqrs', () =>
  require('../../__shared__/veloqrsStub').withOverrides({
    decodeCoords: () => [
      { latitude: 46.5, longitude: 6.6 },
      { latitude: 46.6, longitude: 6.7 },
    ],
  })
);
jest.mock('@/features/routes/components/RouteMapView', () => ({
  ROUTE_MAP_FIT_PADDING: 40,
  RouteMapView: (props: unknown) => {
    mockMapProps(props);
    return null;
  },
}));
jest.mock('@/features/routes/hooks/useRouteDetailData', () => ({
  useRouteDetailData: () => ({
    status: { kind: 'ok' },
    data: {
      group: {
        groupId: 'g_orchard',
        representativeId: 'a1',
        activityIds: ['a1'],
        activityCount: 1,
        customName: 'Orchard loop',
      },
      distanceMeters: 5_000,
      elevationGainMeters: 40,
      encodedRepresentative: new ArrayBuffer(8),
      mapSignatures: [],
    },
  }),
}));
jest.mock('@/features/routes/hooks', () => ({ useRouteMapSignatures: () => ({}) }));
jest.mock('@/shared/ui/useHeroHeaderBottom', () => ({ useHeroHeaderBottom: () => 100 }));

const mockWindow = { width: 390, height: 844 };
jest.mock('react-native/Libraries/Utilities/useWindowDimensions', () => ({
  ...jest.requireActual('react-native/Libraries/Utilities/useWindowDimensions'),
  __esModule: true,
  default: () => ({ ...mockWindow, scale: 3, fontScale: 1 }),
}));

const LAP = [{ lat: 1, lng: 2 }];
const KEY = 'route:g_orchard';

async function setup() {
  openHost('route', 'g_orchard');
  const rootRenders = jest.fn();

  function Root() {
    rootRenders();
    return <RouteDetailMap routeId="g_orchard" />;
  }

  await render(<Root />);
  return { card: detailCardWriter(KEY, 0), rootRenders };
}

const lastMapProps = () => mockMapProps.mock.calls[mockMapProps.mock.calls.length - 1][0];

beforeEach(() => mockMapProps.mockClear());
afterEach(() => closeHost(KEY));

describe('a chart scrub on the route card', () => {
  it('renders the map per index and never the root above it', async () => {
    const { card, rootRenders } = await setup();
    expect(rootRenders).toHaveBeenCalledTimes(1);
    mockMapProps.mockClear();

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await act(() => card.selectAttempt(id, LAP));
      expect(lastMapProps()).toMatchObject({
        highlightedActivityId: id,
        highlightedLapPoints: LAP,
      });
    }

    expect(mockMapProps).toHaveBeenCalledTimes(5);
    expect(rootRenders).toHaveBeenCalledTimes(1);
  });

  it('renders nothing for a scrub that lands on the attempt already drawn', async () => {
    const { card } = await setup();
    await act(() => card.selectAttempt('a', LAP, new Date(2026, 0, 2)));
    mockMapProps.mockClear();

    await act(() => card.selectAttempt('a', LAP, new Date(2026, 0, 2)));

    expect(mockMapProps).not.toHaveBeenCalled();
  });

  it('hands the map nothing before a scrub and after a clear', async () => {
    const { card } = await setup();
    expect(lastMapProps()).toMatchObject({
      highlightedActivityId: null,
      highlightedLapPoints: undefined,
    });

    await act(() => card.selectAttempt('a', LAP));
    await act(() => card.selectAttempt(null));

    expect(lastMapProps()).toMatchObject({
      highlightedActivityId: null,
      highlightedLapPoints: undefined,
    });
  });
});

describe('the route map under its sheet', () => {
  it('fits the route above the settled stop and keeps the Half fit at Full', async () => {
    await setup();
    const { useMapSheetStops } = jest.requireActual('@/shared/app/mapSheetStop');
    const settle = (index: number) =>
      act(() =>
        useMapSheetStops.setState((store: { sheets: Record<string, unknown> }) => ({
          sheets: { ...store.sheets, [KEY]: { stop: index, toolReturn: null } },
        }))
      );

    await settle(0);
    const peek = lastMapProps().fitPadding.bottom;
    await settle(1);
    const half = lastMapProps().fitPadding.bottom;
    await settle(2);
    const full = lastMapProps().fitPadding.bottom;

    expect(half).toBeGreaterThan(peek);
    expect(full).toBe(half);
    expect(lastMapProps().fitPadding.top).toBeGreaterThanOrEqual(100);
  });
});

describe('the route map beside its side panel', () => {
  afterEach(() => {
    mockWindow.width = 390;
    mockWindow.height = 844;
  });

  it('fits the route beside the panel at the leading edge, with nothing covered below', async () => {
    mockWindow.width = 1024;
    mockWindow.height = 1366;
    await setup();

    const { fitPadding } = lastMapProps();
    expect(fitPadding.left).toBeGreaterThanOrEqual(400);
    expect(fitPadding.right).toBeLessThan(100);
    expect(fitPadding.bottom).toBeLessThan(100);
  });
});
