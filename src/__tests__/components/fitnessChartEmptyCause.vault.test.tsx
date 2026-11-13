/**
 * Scenario: the fitness chart has no wellness days to draw for the range.
 *
 * Expected behaviour: it says where fitness, fatigue and form come from, so the
 * empty chart names what is missing rather than only that something is.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { FitnessChart } from '@/features/fitness/components/FitnessChart';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ i18n: { language: 'en-GB' }, t: (key: string) => key }),
}));

it('gives the cause beside the empty line', () => {
  const tree = render(<FitnessChart data={[]} />);

  expect(tree.getByText('fitness.noData')).toBeTruthy();
  expect(tree.getByText('fitness.noDataCause')).toBeTruthy();
});
