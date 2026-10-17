/**
 * Scenario: the running pace curve's grade adjusted pace switch carried the abbreviation as its
 * accessible name, so a screen reader announced the word "gap".
 *
 * Expected behaviour: the switch is announced by the expanded name while the label beside it
 * keeps the abbreviation.
 */

import React from 'react';
import { render, screen } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import { PaceCurveChart } from '@/features/stats/components/PaceCurveChart';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

jest.mock('@/features/stats/hooks/usePaceCurve', () => ({
  usePaceCurve: () => ({
    data: {
      distances: [400, 1000, 5000, 10000],
      times: [80, 220, 1200, 2500],
      pace: [5, 4.55, 4.17, 4],
      criticalSpeed: 3.3333,
      days: 42,
    },
    isLoading: false,
    error: null,
  }),
}));

jest.mock('@/features/activity/hooks/useActivities', () => ({
  useActivities: () => ({ data: [], isLoading: false }),
}));

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

it('announces the grade adjusted pace switch by its full name', async () => {
  await render(<PaceCurveChart sport="Run" />);

  expect(screen.getByText('GAP')).toBeTruthy();
  expect(screen.getByRole('switch').props.accessibilityLabel).toBe('Grade adjusted pace');
});
