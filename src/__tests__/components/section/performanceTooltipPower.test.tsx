import React from 'react';
import { render } from '@testing-library/react-native';
import { PerformanceTooltip } from '@/features/routes/components/section/PerformanceTooltip';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => true,
  useTheme: () => ({ isDark: false }),
}));

/**
 * Scenario: a lap on a section carries a stored mean power, or none.
 * Expected behaviour: the selected-attempt tooltip shows the watts after the
 * section time, and shows no power text for a lap without a power stream.
 */

const POINT = {
  id: 'p1',
  activityId: 'a1',
  speed: 4,
  date: new Date('2026-01-01T00:00:00Z'),
  activityName: 'Morning loop',
  direction: 'same' as const,
  sectionTime: 200,
  isBest: false,
};

function renderTooltip(avgPower: number | undefined) {
  return render(
    <PerformanceTooltip
      selectedPoint={{ ...POINT, avgPower, x: 0 }}
      isDark={false}
      showPace
      activityColor="#000000"
      onClearSelection={() => {}}
    />
  );
}

describe('PerformanceTooltip mean power', () => {
  it('shows the rounded mean watts', () => {
    const { getByText } = renderTooltip(245.4);
    expect(getByText(/245 W/)).toBeTruthy();
  });

  it('shows no power text when the lap has no power', () => {
    const { queryByText } = renderTooltip(undefined);
    expect(queryByText(/\d W$/)).toBeNull();
  });

  it('shows no power text for zero watts', () => {
    const { queryByText } = renderTooltip(0);
    expect(queryByText(/\d W$/)).toBeNull();
  });
});
