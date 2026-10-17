/**
 * Scenario: the Fitness bests section is titled for a season while it lists the chosen range's
 * bests, and its link back to Best Efforts reads the screen's bare title.
 *
 * Expected behaviour: the section is named for what it lists, best efforts, and its link names
 * the place it opens.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { PerformanceCurveSection } from '@/features/fitness/components/sections/PerformanceCurveSection';
import { SeasonBestsSection } from '@/features/fitness/components/SeasonBestsSection';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats', () => ({
  usePowerCurve: () => ({ data: { secs: [5, 60, 1200] }, isLoading: false, isError: false }),
  usePaceCurve: () => ({ data: { distances: [] }, isLoading: false, isError: false }),
  PowerCurveChart: () => null,
  PaceCurveChart: () => null,
  SwimPaceCurveChart: () => null,
  CurveFreshnessLine: () => null,
  curveFreshness: () => null,
}));

jest.mock('@/features/fitness/components', () => ({ SeasonBestsSection: () => null }));

jest.mock('@/features/activity', () => ({
  useActivityLabels: () => ({ labels: new Map(), error: null }),
  useActivities: () => ({ data: [] }),
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('the Fitness bests section', () => {
  it('is titled best efforts, with no season in its name', () => {
    render(
      <PerformanceCurveSection
        sportMode="Running"
        days={7}
        timeRange="7d"
        currentFTP={null}
        thresholdPace={undefined}
        swimThresholdPace={undefined}
        performanceExpanded={false}
        onPerformanceToggle={() => {}}
        bestsExpanded={false}
        onBestsToggle={() => {}}
        bestsEfforts={[]}
        bestsClimbing={[]}
        bestsClimbingStatus={'ready' as never}
        loadingBests={false}
        bestsHeader={null}
      />
    );

    expect(screen.getByText('Best efforts')).toBeTruthy();
    expect(screen.queryByText(/season/i)).toBeNull();
  });

  it('links to every best effort by that name', () => {
    render(<SeasonBestsSection efforts={[]} sport="Running" period="7d" isLoading={false} />);

    const link = screen.getByTestId('season-bests-view-all');
    expect(link).toHaveTextContent('All best efforts');
    expect(link.props.accessibilityLabel).toBe('All best efforts');
  });
});
