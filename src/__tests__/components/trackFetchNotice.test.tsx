/**
 * Scenario: a fetch run ends with three tracks still missing.
 *
 * Expected behaviour: the athlete sees a line saying so, and closing it takes
 * it down. Nothing else on screen reports this: the tracks are fetched outside
 * the sync service, so sync health stays clean and both other banners stay
 * silent.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';
import { router } from 'expo-router';

import { initializeI18n } from '@/i18n';
import { TrackFetchNotice } from '@/shared/ui/TrackFetchNotice';
import { useTrackFetchNotice } from '@/features/routes/lib/trackFetchNotice';

jest.mock('@/shared/app/useTheme', () => ({ useTheme: () => ({ isDark: false }) }));

jest.mock('react-native-safe-area-context', () => ({
  ...jest.requireActual('react-native-safe-area-context'),
  useSafeAreaInsets: () => ({ top: 20, bottom: 0, left: 0, right: 0 }),
}));

describe('the missing-tracks notice', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(() => {
    jest.clearAllMocks();
    useTrackFetchNotice.setState({ failedIds: [], failedCount: 0, dismissed: false });
  });

  it('says nothing while every track landed', () => {
    const { queryByTestId } = render(<TrackFetchNotice />);

    expect(queryByTestId('track-fetch-notice')).toBeNull();
  });

  it('names how many routes did not download', () => {
    useTrackFetchNotice.setState({ failedCount: 3, dismissed: false });

    const { getByTestId, getByText } = render(<TrackFetchNotice />);

    expect(getByTestId('track-fetch-notice')).toBeTruthy();
    expect(getByText("3 routes didn't download")).toBeTruthy();
  });

  it('counts one route in the singular', () => {
    useTrackFetchNotice.setState({ failedCount: 1, dismissed: false });

    const { getByText } = render(<TrackFetchNotice />);

    expect(getByText("1 route didn't download")).toBeTruthy();
  });

  it('comes down when the athlete closes it', () => {
    useTrackFetchNotice.setState({ failedCount: 2, dismissed: false });

    const { getByTestId, queryByTestId } = render(<TrackFetchNotice />);
    fireEvent.press(getByTestId('track-fetch-notice-dismiss'));

    expect(queryByTestId('track-fetch-notice')).toBeNull();
  });

  it('opens the activity when exactly one route failed', () => {
    useTrackFetchNotice.setState({ failedIds: ['i42'], failedCount: 1, dismissed: false });

    const { getByTestId } = render(<TrackFetchNotice />);
    fireEvent.press(getByTestId('track-fetch-notice-open'));

    expect(router.push).toHaveBeenCalledWith('/activity/i42');
  });

  it('offers no activity to open when several routes failed', () => {
    useTrackFetchNotice.setState({ failedIds: ['a', 'b'], failedCount: 2, dismissed: false });

    const { queryByTestId } = render(<TrackFetchNotice />);

    expect(queryByTestId('track-fetch-notice-open')).toBeNull();
  });
});
