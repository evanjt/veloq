import React from 'react';
import { render } from '@testing-library/react-native';
import { PerformanceTooltip } from '@/features/routes/components/section/PerformanceTooltip';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

let mockIsMetric = false;
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => mockIsMetric,
  useTheme: () => ({ isDark: false }),
}));

/**
 * Scenario: an athlete set to imperial opens a section.
 * Expected behaviour: the scrub tooltip pace and its delta follow the unit setting instead of reading per kilometre and metres.
 */

const POINT = {
  id: 'p1',
  activityId: 'a1',
  speed: 4,
  date: new Date('2026-01-01T00:00:00Z'),
  activityName: 'Morning loop',
  direction: 'same' as const,
  bestSpeed: 5,
  isBest: false,
};

function renderTooltip() {
  return render(
    <PerformanceTooltip
      selectedPoint={{ ...POINT, x: 0 }}
      isDark={false}
      basis="pace"
      onClearSelection={() => {}}
    />
  );
}

describe('section surfaces under the unit setting', () => {
  afterEach(() => {
    mockIsMetric = false;
  });

  it('prints the tooltip pace and delta per mile when imperial', async () => {
    const { getByText, queryByText } = await renderTooltip();
    expect(getByText('6:42 /mi')).toBeTruthy();
    expect(getByText(/\+1:20/)).toBeTruthy();
    expect(queryByText('4:10 /km')).toBeNull();
  });

  it('prints the tooltip pace and delta per kilometre when metric', async () => {
    mockIsMetric = true;
    const { getByText } = await renderTooltip();
    expect(getByText('4:10 /km')).toBeTruthy();
    expect(getByText(/\+50 s/)).toBeTruthy();
  });
});
