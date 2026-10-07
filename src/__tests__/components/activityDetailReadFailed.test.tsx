/**
 * Scenario: the detail bundle read threw, so the Routes and Sections tabs show
 * a failure with a retry in place of their empty-library copy.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { ActivityDetailReadFailed } from '@/features/activity/components/ActivityDetailReadFailed';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/ui', () => {
  const { Text, Pressable } = require('react-native');
  return {
    ErrorStatePreset: ({ message, onRetry }: { message: string; onRetry: () => void }) => (
      <Pressable testID="retry" onPress={onRetry}>
        <Text>{message}</Text>
      </Pressable>
    ),
  };
});

it('names the engine failure and retries on press', () => {
  const onRetry = jest.fn();
  const { getByText, getByTestId, queryByText } = render(
    <ActivityDetailReadFailed error={{ tag: 'Database' }} onRetry={onRetry} />
  );

  expect(getByText('engine.failure.database')).toBeTruthy();
  expect(queryByText('activityDetail.noMatchedSections')).toBeNull();
  fireEvent.press(getByTestId('retry'));
  expect(onRetry).toHaveBeenCalledTimes(1);
});

it('falls back to the load failure line for a non-engine error', () => {
  const { getByText } = render(
    <ActivityDetailReadFailed error={new Error('x')} onRetry={jest.fn()} />
  );
  expect(getByText('activityDetail.failedToLoad')).toBeTruthy();
});
