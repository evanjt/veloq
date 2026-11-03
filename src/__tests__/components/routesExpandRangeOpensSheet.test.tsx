/**
 * Scenario: the routes summary row and the routes footer each offer to widen the downloaded range.
 *
 * Expected behaviour: pressing either opens the history sheet in place and navigates nowhere.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { DataRangeFooter } from '@/features/routes/components/DataRangeFooter';
import { DateRangeSummary } from '@/features/routes/components/DateRangeSummary';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/historyRange', () => ({ openHistoryRange: jest.fn() }));

const { navigateTo } = jest.requireMock('@/shared/app/navigation') as { navigateTo: jest.Mock };
const { openHistoryRange } = jest.requireMock('@/shared/app/historyRange') as {
  openHistoryRange: jest.Mock;
};

beforeEach(() => jest.clearAllMocks());

it('opens the history sheet from the summary row', async () => {
  const view = await render(
    <DateRangeSummary activityCount={3} oldestDate={null} newestDate={null} />
  );

  await fireEvent.press(view.getByText('routesScreen.expandDateRange'));

  expect(openHistoryRange).toHaveBeenCalledTimes(1);
  expect(navigateTo).not.toHaveBeenCalled();
});

it('opens the history sheet from the footer', async () => {
  const view = await render(<DataRangeFooter days={90} />);

  await fireEvent.press(view.getByText('routes.expandInSettings'));

  expect(openHistoryRange).toHaveBeenCalledTimes(1);
  expect(navigateTo).not.toHaveBeenCalled();
});
