/**
 * Scenario: a route group holds activities of more than one sport, so the
 * screen offers a sport picker.
 *
 * The picker starts on the sport most members carry, on the first frame.
 */

import React, { useEffect } from 'react';
import { Text } from 'react-native';
import { act, render } from '@testing-library/react-native';

import { useSportTypeFilter } from '@/features/routes/hooks/useSportTypeFilter';
import type { FfiActivityMetrics } from 'veloqrs';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const committed: (string | undefined)[] = [];

function metricsOf(sports: string[]): Map<string, FfiActivityMetrics> {
  const map = new Map<string, FfiActivityMetrics>();
  sports.forEach((sportType, i) => {
    map.set(`a${i}`, { sportType } as FfiActivityMetrics);
  });
  return map;
}

/** The picker's own setter, so a test can make the athlete's choice. */
const picker: { choose?: (sport: string) => void } = {};

function Probe({ metrics }: { metrics: Map<string, FfiActivityMetrics> }) {
  const filter = useSportTypeFilter(metrics);
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

  it('starts on the sport most of the group carries, on the first committed frame', () => {
    render(<Probe metrics={metricsOf(['Ride', 'Ride', 'Ride', 'Run'])} />);
    expect(committed).toEqual(['Ride']);
  });

  it('selects run when most members ran', () => {
    render(<Probe metrics={metricsOf(['Run', 'Run', 'Run', 'Ride'])} />);
    expect(committed).toEqual(['Run']);
  });

  it('settles a tie alphabetically, so the picker opens the same way twice', () => {
    render(<Probe metrics={metricsOf(['Run', 'Ride'])} />);
    expect(committed).toEqual(['Ride']);
  });

  it('selects nothing when there is only one sport to pick from', () => {
    render(<Probe metrics={metricsOf(['Ride'])} />);
    expect(committed).toEqual([undefined]);
  });

  it("keeps the athlete's own choice over the sport it started on", () => {
    render(<Probe metrics={metricsOf(['Ride', 'Ride', 'Run'])} />);
    committed.length = 0;

    act(() => picker.choose?.('Run'));
    expect(committed).toEqual(['Run']);
  });
});
