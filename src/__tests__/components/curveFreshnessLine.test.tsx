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
    const fetchedAt = new Date(2026, 7, 8, 9, 0, 0).getTime();

    const { getByText } = render(<CurveFreshnessLine freshness={{ kind: 'dated', fetchedAt }} />);

    expect(getByText('From the last sync, 8 Aug')).toBeTruthy();
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
