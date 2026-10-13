/**
 * Scenario: the activity detail screen offers a link to the activity on
 * intervals.icu, for a ride intervals.icu has named and for one it has not
 * (a demo ride, or a recording no upload has answered).
 *
 * Expected behaviour: the link is offered only with the id the engine's detail
 * read hands over, and it opens that id's page, never the row key.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import { InsightfulStats } from '@/features/activity/components/stats/InsightfulStats';
import type { Activity } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub'));
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysWithValues());
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('expo-web-browser', () => ({
  ...jest.requireActual('expo-web-browser'),
  openBrowserAsync: jest.fn(() => Promise.resolve({ type: 'opened' })),
}));

const openBrowser = WebBrowser.openBrowserAsync as jest.MockedFunction<
  typeof WebBrowser.openBrowserAsync
>;

const recording = {
  id: 'local-ride-7',
  type: 'Ride',
  name: 'Ride',
  start_date_local: '2026-09-05T08:00:00',
  average_heartrate: 150,
} as Activity;

beforeEach(() => openBrowser.mockClear());

describe('InsightfulStats web link', () => {
  it('offers no link when intervals.icu has not named the activity', () => {
    const card = render(<InsightfulStats activity={recording} intervalsId={null} />);
    expect(card.getByText('activity.activityStats')).toBeTruthy();
    expect(card.queryByText('activity.viewInIntervalsICU')).toBeNull();
  });

  it('offers no link before the detail read has answered', () => {
    const card = render(<InsightfulStats activity={recording} />);
    expect(card.queryByText('activity.viewInIntervalsICU')).toBeNull();
  });

  it('opens the page of the id the detail read names, not the row key', async () => {
    const card = render(<InsightfulStats activity={recording} intervalsId="i900" />);
    fireEvent.press(card.getByText('activity.viewInIntervalsICU'));
    await waitFor(() => expect(openBrowser).toHaveBeenCalledTimes(1));
    expect(openBrowser).toHaveBeenCalledWith('https://intervals.icu/activities/i900');
  });
});
