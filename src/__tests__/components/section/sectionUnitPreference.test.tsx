import React from 'react';
import { render } from '@testing-library/react-native';
import { PerformanceTooltip } from '@/features/routes/components/section/PerformanceTooltip';
import { MergeConfirmDialog } from '@/features/routes/components/section/MergeConfirmDialog';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

let mockIsMetric = false;
jest.mock('@/shared/app', () => ({
  useMetricSystem: () => mockIsMetric,
  useTheme: () => ({ isDark: false }),
}));

/**
 * Scenario: an athlete set to imperial opens a section.
 * Expected behaviour: the scrub tooltip pace, its delta and the merge dialog
 * distance follow the unit setting instead of reading per kilometre and metres.
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
      showPace
      activityColor="#000000"
      onClearSelection={() => {}}
    />
  );
}

describe('section surfaces under the unit setting', () => {
  afterEach(() => {
    mockIsMetric = false;
  });

  it('prints the tooltip pace and delta per mile when imperial', () => {
    const { getByText, queryByText } = renderTooltip();
    expect(getByText('6:42 /mi')).toBeTruthy();
    expect(getByText(/\+1:20/)).toBeTruthy();
    expect(queryByText('4:10 /km')).toBeNull();
  });

  it('prints the tooltip pace and delta per kilometre when metric', () => {
    mockIsMetric = true;
    const { getByText } = renderTooltip();
    expect(getByText('4:10 /km')).toBeTruthy();
    expect(getByText(/\+50s/)).toBeTruthy();
  });

  it('prints the merge dialog distance in the athlete unit', () => {
    const section = {
      id: 's',
      name: 'Hill',
      sportTypes: ['Run'],
      visitCount: 3,
      distanceMeters: 1287,
    };
    const { getAllByText, queryByText } = render(
      <MergeConfirmDialog
        visible
        primary={section}
        secondary={{ ...section, id: 't', name: 'Hill 2' }}
        onConfirm={() => {}}
        onCancel={() => {}}
        previewDropped={() => []}
      />
    );
    expect(getAllByText('0.8 mi').length).toBeGreaterThan(0);
    expect(queryByText('1287m')).toBeNull();
  });
});
