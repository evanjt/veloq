/**
 * Scenario: the athlete taps an activity card, and the detail screen used to
 * wait for the push animation before reading the engine.
 *
 * Expected behaviour: the read runs at navigation time and the screen's first
 * render paints what it returned, so no second read happens on mount.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import {
  prefetchActivityDetailData,
  useActivityDetailData,
} from '@/features/activity/hooks/useActivityDetailData';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const mockGetEngine = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockGetEngine(),
}));

function activityDetail(activityCount: number) {
  return {
    activityCount,
    sectionCount: 0,
    routeGroups: [],
    matchedSections: [],
    customSections: [],
    encounters: [],
    highlights: { indicators: [], routeHighlights: [] },
    sectionTraces: [],
    prSectionIds: [],
  };
}

/** An engine whose reads are counted and whose channels can be fired by hand. */
function stubEngine(counts: Record<string, number>) {
  const listeners: (() => void)[] = [];
  const reads: string[] = [];
  return {
    reads,
    fireChange: () => listeners.slice().forEach((cb) => cb()),
    engine: {
      getActivityDetailData: (id: string) => {
        reads.push(id);
        return activityDetail(counts[id]);
      },
      subscribe: (_event: string, cb: () => void) => {
        listeners.push(cb);
        return () => {
          const at = listeners.indexOf(cb);
          if (at >= 0) listeners.splice(at, 1);
        };
      },
    },
  };
}

function Probe({ id }: { id: string }) {
  const { data } = useActivityDetailData(id);
  return <Text>{String(data?.activityCount)}</Text>;
}

describe('activity detail prefetch', () => {
  afterEach(() => mockGetEngine.mockReset());

  it('paints the prefetched bundle on the first render without reading again', () => {
    const stub = stubEngine({ a: 1 });
    mockGetEngine.mockReturnValue(stub.engine);

    prefetchActivityDetailData('a');
    expect(stub.reads).toEqual(['a']);

    const screen = render(<Probe id="a" />);
    expect(screen.getByText('1')).toBeTruthy();
    expect(stub.reads).toEqual(['a']);
  });

  it('reads for itself when the prefetch was for another activity', () => {
    const stub = stubEngine({ a: 1, b: 2 });
    mockGetEngine.mockReturnValue(stub.engine);

    prefetchActivityDetailData('a');
    const screen = render(<Probe id="b" />);

    expect(screen.getByText('2')).toBeTruthy();
    expect(stub.reads).toEqual(['a', 'b']);
  });

  it('drops the prefetch when the engine changes before the screen mounts', () => {
    const counts: Record<string, number> = { a: 1 };
    const stub = stubEngine(counts);
    mockGetEngine.mockReturnValue(stub.engine);

    prefetchActivityDetailData('a');
    counts.a = 7;
    stub.fireChange();

    const screen = render(<Probe id="a" />);
    expect(screen.getByText('7')).toBeTruthy();
    expect(stub.reads).toEqual(['a', 'a']);
  });

  it('uses a prefetch once, so a second screen reads for itself', () => {
    const stub = stubEngine({ a: 1 });
    mockGetEngine.mockReturnValue(stub.engine);

    prefetchActivityDetailData('a');
    render(<Probe id="a" />);
    render(<Probe id="a" />);

    expect(stub.reads).toEqual(['a', 'a']);
  });

  it('leaves nothing cached when the engine is missing at press time', () => {
    mockGetEngine.mockReturnValue(null);
    prefetchActivityDetailData('a');

    const stub = stubEngine({ a: 4 });
    mockGetEngine.mockReturnValue(stub.engine);
    const screen = render(<Probe id="a" />);

    expect(screen.getByText('4')).toBeTruthy();
    expect(stub.reads).toEqual(['a']);
  });
});
