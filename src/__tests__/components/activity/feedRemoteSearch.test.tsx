/**
 * Scenario: a feed search that has run out on the device offers a search of the
 * athlete's account, and shows the rows it finds that the device does not hold.
 *
 * Expected behaviour: nothing is shown until the local list has run out, the
 * request goes out only on the press, a found row carries the not-on-device
 * mark, and pressing it downloads that one activity by its server id and opens
 * it. A refusal says so and offers a retry, a source with no search shows
 * nothing, and an answer is dropped once the filter has moved on.
 */

import React from 'react';
import { act, fireEvent, render, waitFor } from '@testing-library/react-native';
import { FfiRemoteSearchStatus } from 'veloqrs';

import { FeedRemoteSearch } from '@/features/activity/components/FeedRemoteSearch';
import type { FeedFilter } from '@/features/activity/lib/feedFilter';
import {
  downloadRemoteActivity,
  searchRemoteActivities,
} from '@/shared/native/remoteActivitySearch';
import { navigateTo } from '@/shared/app/navigation';

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());
jest.mock('@/shared/native/remoteActivitySearch', () => ({
  searchRemoteActivities: jest.fn(),
  downloadRemoteActivity: jest.fn(),
}));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

const search = searchRemoteActivities as jest.Mock;

const FILTER: FeedFilter = {
  searchText: 'harbour',
  groups: new Set(),
  range: null,
  distance: null,
  duration: null,
};

const row = (id: string, name: string) => ({
  id,
  name,
  sportType: 'Ride',
  startDateLocal: '2024-03-02T08:00:00',
  distance: 40_000,
  movingTime: 5_400,
});

const answer = (
  status: FfiRemoteSearchStatus,
  rows = [] as ReturnType<typeof row>[],
  capped = false
) => ({
  status,
  rows,
  fetched: rows.length,
  capped,
});

beforeEach(() => {
  jest.clearAllMocks();
});

it('shows nothing until the local list has run out', async () => {
  const { queryByTestId } = await render(<FeedRemoteSearch filter={FILTER} offered={false} />);

  expect(queryByTestId('feed-remote-search')).toBeNull();
  expect(search).not.toHaveBeenCalled();
});

it('asks the account only when the offer is pressed, with the feed filter', async () => {
  search.mockResolvedValue(answer(FfiRemoteSearchStatus.Found));
  const { getByTestId } = await render(<FeedRemoteSearch filter={FILTER} offered />);
  expect(search).not.toHaveBeenCalled();

  await fireEvent.press(getByTestId('feed-remote-search-offer'));

  await waitFor(() => expect(getByTestId('feed-remote-search-none')).toBeTruthy());
  expect(search).toHaveBeenCalledTimes(1);
  expect(search).toHaveBeenCalledWith(expect.objectContaining({ needle: 'harbour' }));
});

it('marks each found row as not on the device and downloads then opens the pressed one', async () => {
  search.mockResolvedValue(
    answer(FfiRemoteSearchStatus.Found, [row('i5', 'Harbour loop'), row('i6', 'Harbour dash')])
  );
  const { getByTestId, getByText } = await render(<FeedRemoteSearch filter={FILTER} offered />);
  await fireEvent.press(getByTestId('feed-remote-search-offer'));
  await waitFor(() => expect(getByTestId('remote-activity-i5')).toBeTruthy());

  expect(getByText('Harbour loop')).toBeTruthy();
  expect(getByTestId('remote-activity-i5-mark')).toBeTruthy();
  expect(getByTestId('remote-activity-i6-mark')).toBeTruthy();

  await fireEvent.press(getByTestId('remote-activity-i6'));

  expect(downloadRemoteActivity).toHaveBeenCalledTimes(1);
  expect(downloadRemoteActivity).toHaveBeenCalledWith('i6');
  expect(navigateTo).toHaveBeenCalledWith('/activity/i6');
});

it('says when the account stopped at its limit', async () => {
  search.mockResolvedValue(answer(FfiRemoteSearchStatus.Found, [row('i5', 'Harbour loop')], true));
  const { getByTestId } = await render(<FeedRemoteSearch filter={FILTER} offered />);

  await fireEvent.press(getByTestId('feed-remote-search-offer'));

  await waitFor(() => expect(getByTestId('feed-remote-search-capped')).toBeTruthy());
});

it('reports a refused search and asks again on retry', async () => {
  search.mockResolvedValueOnce(answer(FfiRemoteSearchStatus.Failed));
  search.mockResolvedValueOnce(answer(FfiRemoteSearchStatus.Found, [row('i5', 'Harbour loop')]));
  const { getByTestId, getByText } = await render(<FeedRemoteSearch filter={FILTER} offered />);

  await fireEvent.press(getByTestId('feed-remote-search-offer'));
  await waitFor(() => expect(getByText('feed.remote.failed')).toBeTruthy());
  await fireEvent.press(getByTestId('feed-remote-search-retry'));

  await waitFor(() => expect(getByTestId('remote-activity-i5')).toBeTruthy());
  expect(search).toHaveBeenCalledTimes(2);
});

it('shows nothing for a source with no search', async () => {
  search.mockResolvedValue(answer(FfiRemoteSearchStatus.Unavailable));
  const { getByTestId, queryByTestId } = await render(<FeedRemoteSearch filter={FILTER} offered />);

  await fireEvent.press(getByTestId('feed-remote-search-offer'));

  await waitFor(() => expect(queryByTestId('feed-remote-search')).toBeNull());
});

it('drops an answer that lands after the filter changed and offers again', async () => {
  let resolveFirst: (value: unknown) => void = () => {};
  search.mockReturnValueOnce(new Promise((resolve) => (resolveFirst = resolve)));
  const { getByTestId, queryByTestId, rerender } = await render(
    <FeedRemoteSearch filter={FILTER} offered />
  );
  const press = fireEvent.press(getByTestId('feed-remote-search-offer'));

  await rerender(<FeedRemoteSearch filter={{ ...FILTER, searchText: 'ferry' }} offered />);
  await act(async () => {
    resolveFirst(answer(FfiRemoteSearchStatus.Found, [row('i5', 'Harbour loop')]));
  });
  await press;

  expect(queryByTestId('remote-activity-i5')).toBeNull();
  expect(getByTestId('feed-remote-search-offer')).toBeTruthy();
});
