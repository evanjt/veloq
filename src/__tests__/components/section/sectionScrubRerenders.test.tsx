/**
 * Scenario: a chart scrub on the section card writes the scrubbed attempt for the map under the
 * sheet to draw, and every new index committed the whole screen while the state sat in its root.
 *
 * Expected behaviour: the scrub is the card's state in the host's entry. A new index renders the
 * map that draws it and nothing above it, and a clear hands the map nothing again. The line the
 * delta plot colours and the direction the chart is on reach the map the same way.
 */

import React from 'react';
import { render, act } from '@testing-library/react-native';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import { SectionDetailMap } from '@/features/routes/components/SectionDetailMap';
import { detailCardWriter } from '@/features/routes/lib/detailCardState';
import { closeHost, openHost } from '@/shared/app/mapSheetHost';
import type { FrequentSection } from '@/types';

const mockMapProps = jest.fn();

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: (props: unknown) => {
    mockMapProps(props);
    return null;
  },
}));
jest.mock('@/shared/async/useAfterNavigationTransition', () => ({
  useAfterNavigationTransition: (task: () => void) =>
    jest.requireActual('react').useEffect(task, [task]),
}));
jest.mock('@/features/routes/hooks/useSectionDetailData', () => ({
  useSectionDetailData: () => ({ data: null, allActivityTraces: undefined }),
}));
jest.mock('@/features/routes/hooks/useSectionDataRefresh', () => ({
  useSectionDataRefresh: () => ({ section: mockSection }),
}));

const mockSection: FrequentSection = {
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
const KEY = 'section:s1';

async function setup() {
  openHost('section', 's1');
  const rootRenders = jest.fn();

  function Root() {
    rootRenders();
    return (
      <QueryClientProvider client={client}>
        <SectionDetailMap sectionId="s1" />
      </QueryClientProvider>
    );
  }

  const client = new QueryClient();
  const tree = await render(<Root />);
  const { selectAttempt, setDeltaLine, setShownDirection } = detailCardWriter(KEY);
  const store = { set: selectAttempt };
  return { store, setDeltaLine, setShownDirection, rootRenders, tree };
}

const lastMapProps = () => mockMapProps.mock.calls[mockMapProps.mock.calls.length - 1][0];

beforeEach(() => mockMapProps.mockClear());
afterEach(() => closeHost(KEY));

describe('a chart scrub on the section card', () => {
  it('renders the map per index and never the root above it', async () => {
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

  it('hands the map the direction the chart is on and the line the delta plot colours', async () => {
    const { setDeltaLine, setShownDirection } = await setup();
    const deltaLine = { activityId: 'a', bands: [] } as never;

    await act(() => setShownDirection('reverse'));
    await act(() => setDeltaLine(deltaLine));

    expect(lastMapProps()).toMatchObject({ shownDirection: 'reverse', deltaLine });
  });
});
