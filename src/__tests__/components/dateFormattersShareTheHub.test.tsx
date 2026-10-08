/**
 * Scenario: the section summary card's First and Last values and the insight
 * methodology sheet's source activity dates each formatted dates themselves.
 *
 * Expected behaviour: each surface renders through the `shared/format` hub, so
 * a change to the hub reaches them and a day string keeps its own local day.
 */

import React from 'react';
import { render } from '@testing-library/react-native';

import { initialiseI18n } from '@/i18n';
import * as hub from '@/shared/format/format';
import { SectionInfoCard } from '@/features/routes/components/section/SectionInfoCard';
import { MethodologySection } from '@/features/insights/components/MethodologySection';

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

describe('methodology source activity dates', () => {
  const insight = {
    id: 'test',
    supportingData: {
      activities: [{ activityId: 'a1', activityName: 'Morning ride', date: '2026-03-14' }],
    },
  } as never;

  it('renders a day string through the hub full date', () => {
    const { getByText } = render(<MethodologySection insight={insight} />);
    expect(getByText(hub.formatFullDate('2026-03-14'))).toBeTruthy();
  });

  it('hands Intl the local day, not UTC midnight', () => {
    const seen: Date[] = [];
    const original = Date.prototype.toLocaleDateString;
    jest.spyOn(Date.prototype, 'toLocaleDateString').mockImplementation(function (
      this: Date,
      ...args: Parameters<typeof original>
    ) {
      seen.push(this);
      return original.apply(this, args);
    });
    render(<MethodologySection insight={insight} />);
    expect(seen.map((d) => d.getTime())).toContain(new Date(2026, 2, 14).getTime());
  });
});
