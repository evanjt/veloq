import React from 'react';
import { render } from '@testing-library/react-native';

import enGB from '@/i18n/locales/en-GB.json';
import { RouteDetailChart } from '@/features/routes/components/RouteDetailChart';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/features/routes/components/section', () => ({
  PerformanceChartPanel: () => null,
}));

it('explains that route times use moving time beside the performance chart', () => {
  const { getByTestId } = render(
    <RouteDetailChart
      chartData={[]}
      trendCurves={{}}
      activityType="Ride"
      isDark={false}
      bestForwardRecord={null}
      bestReverseRecord={null}
      bestForwardIsRecord={false}
      bestReverseIsRecord={false}
      forwardStats={null}
      reverseStats={null}
      onActivitySelect={jest.fn()}
      onExcludeActivity={jest.fn()}
      onIncludeActivity={jest.fn()}
      onSetAsReference={jest.fn()}
      referenceActivityId={undefined}
      showExcluded={false}
      hasExcluded={false}
      onToggleShowExcluded={jest.fn()}
    />
  );

  expect(getByTestId('route-time-method').props.children).toBe('routes.timeMethod');
  expect(enGB.routes.timeMethod).toMatch(/moving time/i);
});
