/**
 * Scenario: a workout is planned for today and the window holds no wellness row.
 *
 * Expected behaviour: the workout renders and the readiness row does not, so
 * no form figure is built from absent loads.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { TodayBanner } from '@/features/routes/components/TodayBanner';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ i18n: { language: 'en-AU' }, t: (key: string) => key }),
}));

jest.mock('@/features/home/hooks/useTodayWorkout', () => ({
  useTodayWorkout: () => ({
    todayWorkout: {
      id: 1,
      name: 'Tempo intervals',
      day: '2026-01-02',
      sport: 'Run',
      movingTime: 3600,
      lines: [],
      bar: [],
    },
    tomorrowWorkout: null,
    isLoading: false,
  }),
}));
jest.mock('@/features/home/hooks/useWorkoutSections', () => ({
  useWorkoutSections: () => ({ sections: [] }),
}));
jest.mock('@/features/wellness', () => ({
  useWellness: () => ({ data: [] }),
}));

describe('TodayBanner without a form reading', () => {
  it('draws the planned workout and no readiness row', async () => {
    const { queryByText, getByText } = await render(<TodayBanner form={null} />);

    expect(getByText(/Tempo intervals/)).toBeTruthy();
    expect(queryByText(/TSB/)).toBeNull();
    expect(queryByText(/Grey zone/)).toBeNull();
    expect(queryByText(/^(today|routeIntelligence\.today)$/i)).toBeNull();
  });
});
