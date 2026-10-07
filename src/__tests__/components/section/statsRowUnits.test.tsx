/**
 * Scenario: an imperial athlete opens a section; the stats row shows pace.
 * Expected behaviour: the average and best pace are per mile, not per kilometre.
 */
import React from 'react';
import { render } from '@testing-library/react-native';
import { StatsRow } from '@/features/routes/components/section/StatsRow';

let mockIsMetric = false;
jest.mock('@/shared/app', () => ({
  ...jest.requireActual('@/shared/app'),
  useMetricSystem: () => mockIsMetric,
}));

const props: React.ComponentProps<typeof StatsRow> = {
  direction: 'forward' as const,
  stats: { avgTime: 300, lastActivity: null, count: 3, avgSpeed: 3.5 },
  bestRecord: { bestPace: 4, bestTime: 250, activityDate: new Date(0) },
  bestIsRecord: true,
  pointCount: 3,
  color: '#000000',
  showPace: true,
  isDark: false,
};

describe('StatsRow pace units', () => {
  it('prints per mile for an imperial athlete', () => {
    mockIsMetric = false;
    const { toJSON } = render(<StatsRow {...props} />);
    const out = JSON.stringify(toJSON());
    expect(out).toContain('/mi');
    expect(out).not.toContain('/km');
  });

  it('prints per kilometre for a metric athlete', () => {
    mockIsMetric = true;
    const { toJSON } = render(<StatsRow {...props} />);
    const out = JSON.stringify(toJSON());
    expect(out).toContain('/km');
    expect(out).not.toContain('/mi');
  });

  it('prints the engine average speed as the average pace, not the section length over the mean time', () => {
    mockIsMetric = true;
    const { toJSON } = render(
      <StatsRow {...props} stats={{ ...props.stats!, avgTime: 306, avgSpeed: 2.5 }} />
    );
    const out = JSON.stringify(toJSON());
    expect(out).toContain('6:40 /km');
  });
});
