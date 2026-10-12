/**
 * Scenario: the detail bundle read threw, so the Routes and Sections tabs show
 * a failure with a retry in place of their empty-library copy.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ActivityDetailReadFailed } from '@/features/activity/components/ActivityDetailReadFailed';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => {
  const { colors } = jest.requireActual('@/theme');
  return { useTheme: () => ({ isDark: false, colors }) };
});
jest.mock('@/shared/ui', () => ({
  ErrorState: jest.requireActual('@/shared/ui/ErrorState').ErrorState,
}));

it('names the engine failure and retries on press', async () => {
  const onRetry = jest.fn();
  const { getByText, getByTestId, queryByText } = await render(
    <ActivityDetailReadFailed error={{ tag: 'Database' }} onRetry={onRetry} />
  );

  expect(getByText('engine.failure.database')).toBeTruthy();
  expect(queryByText('activityDetail.noMatchedSections')).toBeNull();
  await fireEvent.press(getByTestId('error-state-retry'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('falls back to the load failure line for a non-engine error', async () => {
  const { getByText } = await render(
    <ActivityDetailReadFailed error={new Error('x')} onRetry={jest.fn()} />
  );
  expect(getByText('activityDetail.failedToLoad')).toBeTruthy();
});
