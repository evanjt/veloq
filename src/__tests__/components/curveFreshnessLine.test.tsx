/**
 * Scenario: a curve fetched weeks ago was drawn as though it were current, and
 * one never fetched drew an empty chart with nothing to say why.
 *
 * Expected behaviour: one quiet line under the header, dated or saying the curve
 * has not been downloaded, and nothing at all while the first fetch is in
 * flight.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import { CurveFreshnessLine } from '@/features/stats/components/CurveFreshnessLine';

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

describe('the curve freshness line', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  it('dates a stored curve from the fetch behind it', () => {
    jest.setSystemTime(new Date(2026, 8, 27, 12, 0));
    const fetchedAt = new Date(2026, 7, 8, 9, 0, 0).getTime();

    const { getByText } = render(<CurveFreshnessLine freshness={{ kind: 'dated', fetchedAt }} />);

    expect(getByText('From the last sync, 8 Aug')).toBeTruthy();
  });

  it('names the year of a fetch from before New Year', () => {
    jest.setSystemTime(new Date(2027, 0, 1, 0, 30));
    const fetchedAt = new Date(2026, 11, 20, 9, 0, 0).getTime();

    const { getByText } = render(<CurveFreshnessLine freshness={{ kind: 'dated', fetchedAt }} />);

    expect(getByText('From the last sync, 20 Dec 2026')).toBeTruthy();
  });

  it('says yesterday for a fetch late on the last day of a month', () => {
    jest.setSystemTime(new Date(2026, 4, 1, 0, 30));
    const fetchedAt = new Date(2026, 3, 30, 23, 30).getTime();

    const { getByText } = render(<CurveFreshnessLine freshness={{ kind: 'dated', fetchedAt }} />);

    expect(getByText('From the last sync, Yesterday')).toBeTruthy();
  });

  it('says a curve has never been downloaded', () => {
    const { getByText } = render(<CurveFreshnessLine freshness={{ kind: 'never' }} />);

    expect(getByText('Not downloaded yet')).toBeTruthy();
  });

  it('draws nothing while the first fetch is in flight', () => {
    const { queryByTestId } = render(<CurveFreshnessLine freshness={null} />);

    expect(queryByTestId('curve-freshness')).toBeNull();
  });
});
