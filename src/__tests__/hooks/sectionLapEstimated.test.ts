/**
 * Scenario: the section performance read returns a lap the engine timed by
 * projection to a gate next to one timed on the ground.
 *
 * Expected behaviour: each lap in the render shape carries the engine's flag as
 * read, so the lap list labels the estimate and nothing is re-derived.
 */

import { toPerformanceRecord } from '@/features/routes/hooks/useSectionPerformances';
import type { SectionPerformanceResult } from 'veloqrs';

type FfiRecord = SectionPerformanceResult['records'][0];
type FfiLap = FfiRecord['laps'][0];

function lap(id: string, estimated: boolean): FfiLap {
  return {
    id,
    activityId: 'a1',
    time: 120,
    pace: 5,
    distance: 600,
    direction: 'same',
    startIndex: 0,
    endIndex: 30,
    excluded: false,
    outsideDistanceBand: false,
    isRecord: false,
    estimated,
  };
}

it('carries the estimated flag of each lap into the render shape', () => {
  const record = toPerformanceRecord({
    activityId: 'a1',
    activityName: 'Ride',
    activityDate: 1_790_000_000,
    laps: [lap('gated', false), lap('projected', true)],
    lapCount: 2,
    bestTime: 120,
    bestPace: 5,
    avgTime: 120,
    avgPace: 5,
    direction: 'same',
    sectionDistance: 600,
  } as FfiRecord);

  expect(record.laps.map((l) => [l.id, l.estimated])).toEqual([
    ['gated', false],
    ['projected', true],
  ]);
});
