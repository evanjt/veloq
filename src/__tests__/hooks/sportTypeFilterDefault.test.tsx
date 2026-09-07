/**
 * Scenario: a route group holds activities of more than one sport, so the
 * screen offers a sport picker.
 *
 * Expected behaviour: the group's own sport is selected on the first frame.
 * It was written into state by an effect, so the picker committed once with
 * nothing selected before settling.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useSportTypeFilter } from '@/features/routes/hooks/useSportTypeFilter';
import type { FfiActivityMetrics, RouteGroup } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const committed: (string | undefined)[] = [];

function metricsOf(sports: string[]): Map<string, FfiActivityMetrics> {
  const map = new Map<string, FfiActivityMetrics>();
  sports.forEach((sportType, i) => {
    map.set(`a${i}`, { sportType } as FfiActivityMetrics);
  });
  return map;
}

function groupOf(sportType: string | undefined): RouteGroup {
  return { sportType } as RouteGroup;
}

/** The picker's own setter, so a test can make the athlete's choice. */
const picker: { choose?: (sport: string) => void } = {};

function Probe({
  metrics,
  group,
}: {
  metrics: Map<string, FfiActivityMetrics>;
  group: RouteGroup | null;
}) {
  const filter = useSportTypeFilter(metrics, group);
  useEffect(() => {
    committed.push(filter.selectedSportType);
    picker.choose = filter.setSelectedSportType;
  });
  return <Text>{filter.selectedSportType ?? 'none'}</Text>;
}

describe('the sport picker on a cross-sport route group', () => {
  beforeEach(() => {
    committed.length = 0;
  });

  it("selects the group's own sport on the first committed frame", () => {
    render(<Probe metrics={metricsOf(['Ride', 'Run'])} group={groupOf('Run')} />);
    expect(committed).toEqual(['Run']);
  });

  it('falls back to the first sport when the group names none', () => {
    render(<Probe metrics={metricsOf(['Ride', 'Run'])} group={groupOf(undefined)} />);
    expect(committed).toEqual(['Ride']);
  });

  it('selects nothing when there is only one sport to pick from', () => {
    render(<Probe metrics={metricsOf(['Ride'])} group={groupOf('Ride')} />);
    expect(committed).toEqual([undefined]);
  });

  it("keeps the athlete's own choice over the group's sport", () => {
    render(<Probe metrics={metricsOf(['Ride', 'Run'])} group={groupOf('Run')} />);
    committed.length = 0;

    act(() => picker.choose?.('Ride'));
    expect(committed).toEqual(['Ride']);
  });
});
