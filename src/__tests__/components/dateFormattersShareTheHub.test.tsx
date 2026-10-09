/**
 * Scenario: the section summary card's First and Last values formatted dates
 * themselves.
 *
 * Expected behaviour: the card renders through the `shared/format` hub, so a
 * change to the hub reaches it.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import * as hub from '@/shared/format/format';
import { SectionInfoCard } from '@/features/routes/components/section/SectionInfoCard';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

beforeAll(async () => {
  await initialiseI18n('en-AU');
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('section summary card dates', () => {
  it('renders First and Last through the hub axis date', () => {
    jest.spyOn(hub, 'formatAxisDate').mockImplementation((d: Date) => `axis:${d.getFullYear()}`);
    const { getByTestId } = render(
      <SectionInfoCard
        firstActivityDate={new Date(2024, 0, 1)}
        lastActivityDate={new Date(2026, 2, 1)}
        bestForwardRecord={null}
        bestReverseRecord={null}
        forwardStats={null}
        reverseStats={null}
        sportType="Run"
        isDark={false}
      />
    );
    expect(getByTestId('section-first')).toHaveTextContent('axis:2024');
    expect(getByTestId('section-last')).toHaveTextContent('axis:2026');
  });

  it('shows no First or Last until the engine dates a visit, and holds its place while pending', () => {
    const props = {
      firstActivityDate: null,
      lastActivityDate: null,
      bestForwardRecord: null,
      bestReverseRecord: null,
      forwardStats: null,
      reverseStats: null,
      sportType: 'Run',
      isDark: false,
    };
    const empty = render(<SectionInfoCard {...props} />);
    expect(empty.queryByTestId('section-first')).toBeNull();
    expect(empty.queryByTestId('section-info-pending')).toBeNull();

    const pending = render(<SectionInfoCard {...props} pending />);
    expect(pending.getByTestId('section-info-pending')).toBeTruthy();
  });
});
