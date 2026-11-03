/**
 * Scenario: a chart over a range that is only partly downloaded shows a note.
 *
 * Expected behaviour: tapping the note opens the history sheet in place, where the
 * download's progress is shown.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { RangePartlyDownloadedNote } from '@/features/stats/components/RangePartlyDownloadedNote';

jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({ t: (key: string) => key }),
}));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));
jest.mock('@/shared/app/historyRange', () => ({ openHistoryRange: jest.fn() }));

const { navigateTo } = jest.requireMock('@/shared/app/navigation') as { navigateTo: jest.Mock };
const { openHistoryRange } = jest.requireMock('@/shared/app/historyRange') as {
  openHistoryRange: jest.Mock;
};

describe('the partly downloaded range note', () => {
  it('opens the history sheet when tapped, and navigates nowhere', async () => {
    const view = await render(<RangePartlyDownloadedNote testID="note" />);

    await fireEvent.press(view.getByTestId('note'));

    expect(openHistoryRange).toHaveBeenCalledTimes(1);
    expect(navigateTo).not.toHaveBeenCalled();
  });

  it('is announced as a link with the note as its text', async () => {
    const view = await render(<RangePartlyDownloadedNote testID="note" />);

    expect(view.getByRole('link')).toBeTruthy();
    expect(view.getByText('stats.rangePartlyDownloaded')).toBeTruthy();
  });
});
