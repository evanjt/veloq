/**
 * Scenario: one stale PR opportunity and one section the detector recut. The
 * athlete opens Insights, `markAsSeen` stores both ids, and the dot stayed on
 * both cards on every later visit because the generators set it themselves.
 *
 * Expected behaviour: the dot comes from the fingerprint diff alone, so a card
 * whose id is in the stored fingerprint has none, and one whose id is not has
 * one.
 */

import { act, renderHook } from '@testing-library/react-native';
import { stubIdleScheduler, type IdleScheduler } from '../__shared__/idleScheduler';
import type { StalePrOpportunity } from 'veloqrs';

import { useInsights } from '@/features/insights/hooks/useInsights';
import {
  computeInsightsFromData,
  fetchInsightsDataFromEngine,
} from '@/features/insights/lib/computeInsightsData';
import { generateStalePRInsights } from '@/features/insights/generators/stalePr';
import { generateSectionChangedInsights } from '@/features/insights/generators/sectionChanged';
import { useInsightsStore } from '@/features/insights/store';
import { getEngine } from '@/shared/native/engine';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [] }),
}));
jest.mock('@/features/insights/lib/computeInsightsData', () => ({
  fetchInsightsDataFromEngine: jest.fn(),
  computeInsightsFromData: jest.fn(),
}));
jest.mock('@/features/insights/lib/fingerprintStore', () => ({
  readInsightFingerprint: jest.fn(async () => ''),
  writeInsightFingerprint: jest.fn(async () => {}),
}));

const NOW = 1_760_000_000_000;
const t = (key: string) => key;

const OPPORTUNITY = {
  sectionId: 'climb',
  sectionName: 'The Climb',
  bestTimeSecs: 372,
  daysSinceLast: 40,
  traversalCount: 6,
  fitnessMetric: 'power',
  currentValue: 252,
  previousValue: 238,
  gainPercent: 6,
  unit: 'W',
  sportType: 'Ride',
} as unknown as StalePrOpportunity;

function generated() {
  return [
    ...generateStalePRInsights([OPPORTUNITY], t, NOW),
    ...generateSectionChangedInsights(
      [{ sectionId: 'flat', sectionName: 'Flat', kind: 'recut', at: NOW - 3_600_000 }],
      NOW,
      t
    ),
  ];
}

function renderInsights() {
  const hook = renderHook(() => useInsights());
  act(() => {
    jest.runOnlyPendingTimers();
  });
  return hook;
}

let idle: IdleScheduler;

describe('the new dot on a stale PR and a section-changed card', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    (getEngine as jest.Mock).mockReturnValue({ subscribe: jest.fn(() => () => {}) });
    (fetchInsightsDataFromEngine as jest.Mock).mockReturnValue({
      insightsData: { sportTypes: [] },
      summaryCardData: null,
    });
    (computeInsightsFromData as jest.Mock).mockImplementation(() => ({
      insights: generated(),
      failed: false,
    }));
    idle = stubIdleScheduler('immediate');
  });

  afterEach(() => {
    idle.restore();
    jest.useRealTimers();
    jest.restoreAllMocks();
    useInsightsStore.getState().reset();
  });

  it('is gone once the stored fingerprint holds the ids', () => {
    const ids = generated().map((i) => i.id);
    useInsightsStore.setState({ lastSeenFingerprint: [...ids].sort().join('|') });

    const { result } = renderInsights();

    expect(result.current.insights.map((i) => [i.id, i.isNew])).toEqual(
      ids.map((id) => [id, false])
    );
  });

  it('is there while the stored fingerprint does not hold them', () => {
    useInsightsStore.setState({ lastSeenFingerprint: 'some_other_card' });

    const { result } = renderInsights();

    expect(result.current.insights).toHaveLength(2);
    expect(result.current.insights.every((i) => i.isNew)).toBe(true);
  });
});
