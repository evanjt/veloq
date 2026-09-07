/**
 * Scenario: the activity or section detail screen already holds a bundle and the
 * engine reports a change, so the hook's memo reads a newer one.
 *
 * Expected behaviour: no commit shows the superseded bundle. Adopting the new
 * read in an effect meant one committed frame still painted the old one.
 */

import React, { useEffect } from 'react';
import { render } from '@testing-library/react-native';
import { Text } from 'react-native';

import { useActivityDetailData } from '@/features/activity/hooks/useActivityDetailData';
import { useSectionDetailData } from '@/features/routes/hooks/useSectionDetailData';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('@/shared/native/useEngineSubscription', () => ({
  useEngineSubscription: () => 0,
}));

const mockGetEngine = jest.fn();
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockGetEngine(),
}));

/** Only the counts matter here, so the rest of the bundle is empty. */
function activityDetail(activityCount: number) {
  return {
    activityCount,
    sectionCount: 0,
    routeGroups: [],
    totalRouteGroupCount: 0,
    matchedSections: [],
    customSections: [],
    encounters: [],
    highlights: { indicators: [], routeHighlights: [] },
    sectionTraces: [],
    prSectionIds: [],
  };
}

function sectionDetail(activityCount: number) {
  return { activityCount };
}

function collectCommits(useValue: (id: string) => number | undefined) {
  const commits: (number | undefined)[] = [];
  function Probe({ id }: { id: string }) {
    const value = useValue(id);
    useEffect(() => {
      commits.push(value);
    });
    return <Text>{String(value)}</Text>;
  }
  return { commits, Probe };
}

describe('detail bundle freshness', () => {
  afterEach(() => mockGetEngine.mockReset());

  it('never commits the superseded activity bundle', () => {
    const counts: Record<string, number> = { a: 1, b: 2 };
    mockGetEngine.mockReturnValue({
      getActivityDetailData: (id: string) => activityDetail(counts[id]),
    });

    const { commits, Probe } = collectCommits(
      (id) => useActivityDetailData(id, true).data?.activityCount
    );
    const screen = render(<Probe id="a" />);
    expect(commits).toEqual([1]);

    screen.rerender(<Probe id="b" />);
    expect(commits).toEqual([1, 2]);
  });

  it('never commits the superseded section bundle', () => {
    const counts: Record<string, number> = { a: 1, b: 2 };
    mockGetEngine.mockReturnValue({
      getSectionDetailData: (id: string) => sectionDetail(counts[id]),
    });

    const { commits, Probe } = collectCommits(
      (id) => useSectionDetailData(id, 0).data?.activityCount
    );
    const screen = render(<Probe id="a" />);
    expect(commits).toEqual([1]);

    screen.rerender(<Probe id="b" />);
    expect(commits).toEqual([1, 2]);
  });

  it('keeps the bundle it has when the read goes quiet', () => {
    mockGetEngine.mockReturnValue({
      getActivityDetailData: () => activityDetail(3),
    });

    const { commits, Probe } = collectCommits(
      (id) => useActivityDetailData(id, true).data?.activityCount
    );
    const screen = render(<Probe id="a" />);

    mockGetEngine.mockReturnValue(null);
    screen.rerender(<Probe id="a" />);
    expect(commits[commits.length - 1]).toBe(3);
  });
});
