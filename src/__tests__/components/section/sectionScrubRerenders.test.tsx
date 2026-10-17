/**
 * Scenario: a chart scrub on the section screen wrote the scrubbed attempt into
 * state held by the screen root, so every new index committed the whole screen.
 *
 * Expected behaviour: the scrub lives in a store the root creates and never
 * reads. A new index renders the map that draws it and nothing above.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';

import { HighlightedSectionMap } from '@/features/routes/components/section/HighlightedSectionMap';
import { createMapHighlightStore } from '@/features/routes/lib/mapHighlight';
import type { FrequentSection } from '@/types';

const mockMapProps = jest.fn();

jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: (props: unknown) => {
    mockMapProps(props);
    return null;
  },
}));

const SECTION: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportTypes: ['Ride'],
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 8,
  createdAt: '2026-01-01T00:00:00Z',
};

const LAP = [{ lat: 1, lng: 2 }];

async function setup() {
  const store = createMapHighlightStore();
  const rootRenders = jest.fn();

  function Root() {
    rootRenders();
    return (
      <HighlightedSectionMap
        highlight={store}
        section={SECTION}
        height={200}
        interactive={true}
        enableFullscreen={true}
      />
    );
  }

  const tree = await render(<Root />);
  return { store, rootRenders, tree };
}

const lastMapProps = () => mockMapProps.mock.calls[mockMapProps.mock.calls.length - 1][0];

beforeEach(() => mockMapProps.mockClear());

describe('a chart scrub on the section screen', () => {
  it('renders the map per index and never the root that owns the store', async () => {
    const { store, rootRenders } = await setup();
    expect(rootRenders).toHaveBeenCalledTimes(1);
    mockMapProps.mockClear();

    for (const id of ['a', 'b', 'c', 'd', 'e']) {
      await act(() => store.set(id, LAP));
      expect(lastMapProps()).toMatchObject({
        highlightedActivityId: id,
        highlightedLapPoints: LAP,
      });
    }

    expect(mockMapProps).toHaveBeenCalledTimes(5);
    expect(rootRenders).toHaveBeenCalledTimes(1);
  });

  it('hands the map nothing before a scrub and after a clear', async () => {
    const { store } = await setup();
    expect(lastMapProps()).toMatchObject({
      highlightedActivityId: null,
      highlightedLapPoints: undefined,
    });

    await act(() => store.set('a', LAP));
    await act(() => store.set(null));

    expect(lastMapProps()).toMatchObject({
      highlightedActivityId: null,
      highlightedLapPoints: undefined,
    });
  });

  it('keeps a lap trace that arrives with the same attempt', async () => {
    const { store } = await setup();
    await act(() => store.set('a'));
    await act(() => store.set('a', LAP));
    expect(lastMapProps().highlightedLapPoints).toBe(LAP);
  });

  it('does not render the map again for the value it already holds', async () => {
    const { store } = await setup();
    await act(() => store.set('a', LAP));
    mockMapProps.mockClear();

    await act(() => store.set('a', LAP));

    expect(mockMapProps).not.toHaveBeenCalled();
  });

  it("hands the map the scrubbed attempt's date, which its key names the attempt by", async () => {
    const { store } = await setup();
    const ridden = new Date(2023, 2, 12);
    await act(() => store.set('a', LAP, ridden));
    expect(lastMapProps().highlightedActivityDate).toEqual(ridden);

    await act(() => store.set(null));
    expect(lastMapProps().highlightedActivityDate).toBeUndefined();
  });

  it('does not render the map again for the same date read into a new object', async () => {
    const { store } = await setup();
    await act(() => store.set('a', LAP, new Date(2023, 2, 12)));
    mockMapProps.mockClear();

    await act(() => store.set('a', LAP, new Date(2023, 2, 12)));

    expect(mockMapProps).not.toHaveBeenCalled();
  });

  it('takes a set that works detached, as a chart calls it', async () => {
    const store = createMapHighlightStore();
    const { set } = store;
    await act(() => set('a', LAP));
    expect(store.get()).toEqual({ activityId: 'a', lapPoints: LAP });
  });
});
