/**
 * Scenario: the routes tab banner and summary row while a sync is running.
 *
 * Expected behaviour: a progress message and the loading summary each sit
 * beside a moving indicator, and the still sync glyph is gone.
 */

import React from 'react';
import { render } from '@testing-library/react-native';
import { ActivityIndicator } from 'react-native';

import { DateRangeSummary } from '@/features/routes/components/DateRangeSummary';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
}));

const base = { activityCount: 3, oldestDate: null, newestDate: null };

describe('DateRangeSummary waits', () => {
  it('shows an indicator, not a sync glyph, beside a progress message', () => {
    const { UNSAFE_getAllByType, queryByText } = render(
      <DateRangeSummary {...base} syncMessage="Analysing routes... 34%" />
    );
    expect(queryByText('Analysing routes... 34%')).toBeTruthy();
    expect(UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
    expect(
      JSON.stringify(render(<DateRangeSummary {...base} syncMessage="x" />).toJSON())
    ).not.toContain('"sync"');
  });

  it('shows an indicator beside the loading text', () => {
    const { UNSAFE_getAllByType } = render(<DateRangeSummary {...base} isLoading />);
    expect(UNSAFE_getAllByType(ActivityIndicator)).toHaveLength(1);
  });

  it('shows no indicator when nothing is outstanding', () => {
    const { UNSAFE_queryAllByType } = render(<DateRangeSummary {...base} />);
    expect(UNSAFE_queryAllByType(ActivityIndicator)).toHaveLength(0);
  });
});
