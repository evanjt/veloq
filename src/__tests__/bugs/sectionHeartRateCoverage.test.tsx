/**
 * Scenario: heart rate is written per lap only where a stream covered the
 * traversal, which on the corpus is 209 of 6,587 laps. The header averaged
 * whichever laps carried one and printed a bare number, so a section with 104
 * traversals could show a mean over three of them, indistinguishable from a
 * mean over all 104.
 *
 * Expected behaviour: the chip says what it was averaged over whenever that is
 * not every lap, and reads plainly when it is.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { SectionHeader } from '@/features/routes/components/section/SectionHeader';
import { sectionHeartRate } from '@/features/routes/hooks/useSectionLaps';
import type { SectionPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
import type { FrequentSection } from '@/types';

jest.mock('veloqrs', () =>
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../__shared__/veloqrsStub').withOverrides()
);

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('@/features/routes/components/SectionMapView', () => ({
  SectionMapView: () => null,
}));

jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
}));

const BASE: FrequentSection = {
  id: 's1',
  sectionType: 'auto',
  sportType: 'Ride',
  polyline: [],
  distanceMeters: 1200,
  activityIds: ['a1'],
  visitCount: 100,
  createdAt: '2026-01-01T00:00:00Z',
};

function record(activityId: string, hrs: (number | null)[]): SectionPerformanceRecord {
  return {
    activityId,
    activityName: activityId,
    activityDate: new Date('2026-01-01T00:00:00Z'),
    laps: hrs.map((avgHr, i) => ({
      id: `${activityId}-${i}`,
      activityId,
      time: 300,
      pace: 4,
      distance: 1200,
      direction: 'same' as const,
      startIndex: i * 10,
      endIndex: i * 10 + 5,
      avgHr,
    })),
    lapCount: hrs.length,
    bestTime: 300,
    bestPace: 4,
    avgTime: 300,
    avgPace: 4,
    direction: 'same',
    sectionDistance: 1200,
  };
}

function chips(avgHr: ReturnType<typeof sectionHeartRate>) {
  const tree = render(
    <SectionHeader
      section={BASE}
      insetTop={0}
      activityColor="#000000"
      iconName="bike"
      activityCount={100}
      avgHr={avgHr}
      mapReady={true}
      isTrimming={false}
      isExpandMode={false}
      trimStart={0}
      trimEnd={1}
      isEditing={false}
      editName=""
      customName={null}
      nameInputRef={React.createRef()}
      highlightedActivityId={null}
      onBack={jest.fn()}
      onStartEditing={jest.fn()}
      onSaveName={jest.fn()}
      onCancelEdit={jest.fn()}
      onEditNameChange={jest.fn()}
    />
  );
  return tree;
}

describe('the heart rate the section header averages', () => {
  it('counts the laps it averaged and the laps there were', () => {
    const covered = sectionHeartRate([record('a1', [150, null, null]), record('a2', [160, null])]);

    expect(covered).toEqual({ bpm: 155, laps: 2, ofLaps: 5 });
  });

  it('answers nothing when no lap carried a stream', () => {
    expect(sectionHeartRate([record('a1', [null, null])])).toBeNull();
  });

  it('answers nothing for a section with no records at all', () => {
    expect(sectionHeartRate([])).toBeNull();
  });

  it('treats a zero as absent rather than as a reading', () => {
    expect(sectionHeartRate([record('a1', [0, 150])])).toEqual({ bpm: 150, laps: 1, ofLaps: 2 });
  });

  it('names the coverage on the chip when it is not every lap', () => {
    const tree = chips({ bpm: 152, laps: 3, ofLaps: 104 });

    expect(tree.getByText(/sections\.avgHr 152 \(3\/104\)/)).toBeTruthy();
  });

  it('reads plainly when every lap carried one', () => {
    const tree = chips({ bpm: 152, laps: 104, ofLaps: 104 });

    expect(tree.getByText(/sections\.avgHr 152$/)).toBeTruthy();
  });

  it('omits the chip entirely when nothing was averaged', () => {
    const tree = chips(null);

    expect(tree.queryByText(/sections\.avgHr/)).toBeNull();
  });
});
