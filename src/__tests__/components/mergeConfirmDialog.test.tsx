/**
 * Scenario: the athlete opens the merge dialog for two sections, and the
 * engine reports which donor rides have no pass over the kept section's line.
 *
 * Expected behaviour: those rides are named and described as leaving the
 * section while staying in the library; an empty list adds nothing; the list
 * is asked again for the other direction when the radio changes.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { initializeI18n } from '@/i18n';
import { MergeConfirmDialog } from '@/features/routes/components/section/MergeConfirmDialog';

const mockMergePreview = jest.fn();

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

const primary = {
  id: 'sec-a',
  name: 'Main Climb',
  sportTypes: ['Ride'],
  visitCount: 5,
  distanceMeters: 600,
};
const secondary = {
  id: 'sec-b',
  name: 'Other Climb',
  sportTypes: ['Ride'],
  visitCount: 2,
  distanceMeters: 650,
};

function renderDialog() {
  return render(
    <MergeConfirmDialog
      visible
      primary={primary}
      secondary={secondary}
      onConfirm={jest.fn()}
      onCancel={jest.fn()}
      previewDropped={mockMergePreview}
    />
  );
}

describe('the merge dialog', () => {
  beforeAll(async () => {
    await initializeI18n('en-AU');
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('shows nothing extra when no ride would leave', () => {
    mockMergePreview.mockReturnValue([]);

    const { queryByTestId, queryByText } = renderDialog();

    expect(queryByTestId('merge-dropped-rides')).toBeNull();
    expect(queryByText(/stay in your library/)).toBeNull();
  });

  it('names the rides that would leave and says they stay in the library', () => {
    mockMergePreview.mockReturnValue([
      { activityId: 'r1', name: 'Morning Spin', startDate: 1_700_000_000 },
      { activityId: 'r2', name: '', startDate: 1_700_100_000 },
    ]);

    const { getByTestId, getByText } = renderDialog();

    expect(getByTestId('merge-dropped-rides')).toBeTruthy();
    expect(
      getByText(/Rides left out of the merged section: 2\. They stay in your library/)
    ).toBeTruthy();
    expect(getByText(/Morning Spin/)).toBeTruthy();
  });

  it('asks again for the other direction when the radio changes', () => {
    mockMergePreview.mockReturnValue([]);

    const { getByText } = renderDialog();
    expect(mockMergePreview).toHaveBeenLastCalledWith('sec-a', 'sec-b');

    fireEvent.press(getByText('Other Climb'));

    expect(mockMergePreview).toHaveBeenLastCalledWith('sec-b', 'sec-a');
  });

  it('no longer promises that all traversal history is preserved', () => {
    mockMergePreview.mockReturnValue([]);

    const { queryByText } = renderDialog();

    expect(queryByText(/All traversal history/)).toBeNull();
  });
});
