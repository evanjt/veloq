/**
 * Scenario: a chart scrub on the route screen wrote the scrubbed attempt into
 * state held by the screen root, so every new index committed the whole screen.
 *
 * Expected behaviour: the scrub lives in a store the root creates and never
 * reads. A new index renders the map that draws it and nothing above.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';

import { RouteDetailMap } from '@/features/routes/components/RouteDetailMap';
import { createMapHighlightStore } from '@/features/routes/lib/mapHighlight';

const mockMapProps = jest.fn();

jest.mock('@/features/routes/components/RouteMapView', () => ({
  RouteMapView: (props: unknown) => {
    mockMapProps(props);
    return null;
  },
}));

jest.mock('@/shared/ui', () => ({
  useHeroMapHeight: () => 200,
}));

const GROUP = {
  id: 'g1',
  name: 'Loop',
  activityIds: ['a1'],
  activityCount: 1,
  sportType: 'Ride',
  signature: { points: [] },
} as never;

const LAP = [{ lat: 1, lng: 2 }];

function setup() {
  const store = createMapHighlightStore();
  const rootRenders = jest.fn();

  function Root() {
    rootRenders();
    return (
      <RouteDetailMap
        routeGroup={GROUP}
        highlight={store}
        signatures={{}}
        hasMapData={true}
        activityColor="#000000"
      />
    );
  }

  render(<Root />);
  return { store, rootRenders };
}

const lastMapProps = () => mockMapProps.mock.calls[mockMapProps.mock.calls.length - 1][0];

beforeEach(() => mockMapProps.mockClear());

describe('a chart scrub on the route screen', () => {
  it('renders the map per index and never the root that owns the store', () => {
    const { store, rootRenders } = setup();
    expect(rootRenders).toHaveBeenCalledTimes(1);
    mockMapProps.mockClear();

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      act(() => store.set(id, LAP));
      expect(lastMapProps()).toMatchObject({
        highlightedActivityId: id,
        highlightedLapPoints: LAP,
      });
    }

    expect(mockMapProps).toHaveBeenCalledTimes(5);
    expect(rootRenders).toHaveBeenCalledTimes(1);
  });

  it('hands the map nothing before a scrub and after a clear', () => {
    const { store } = setup();
    expect(lastMapProps()).toMatchObject({
      highlightedActivityId: null,
      highlightedLapPoints: undefined,
    });

    act(() => store.set('a', LAP));
    act(() => store.set(null));

    expect(lastMapProps()).toMatchObject({
      highlightedActivityId: null,
      highlightedLapPoints: undefined,
    });
  });
});
