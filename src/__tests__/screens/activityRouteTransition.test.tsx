/**
 * Scenario: the activity route sits inside a nested stack, so its own navigation
 * object never reports the opening push; the parent's does.
 *
 * Expected behaviour: the route hands the content a settled transition as soon as the
 * parent's opening transition ends, well before the one-second fallback.
 */

import React from 'react';
import { act, render } from '@testing-library/react-native';

import ActivityDetailRoute from '@/app/activity/[id]';

type TransitionEvent = { data: { closing: boolean } };
const parentListeners = new Map<string, (event: TransitionEvent) => void>();
const mockOwn = { addListener: jest.fn(() => () => {}), getParent: () => mockParent };
const mockParent = {
  addListener: (name: string, listener: (event: TransitionEvent) => void) => {
    parentListeners.set(name, listener);
    return () => parentListeners.delete(name);
  },
};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'act-1' }),
  useNavigation: () => mockOwn,
}));
jest.mock('@/shared/ui/withScreenBoundary', () => ({
  withScreenBoundary: (Component: unknown) => Component,
}));
jest.mock('@/features/activity', () => {
  const { Text } = require('react-native');
  return {
    ActivityDetailLoading: () => null,
    loadActivityDetailScreenContent: () =>
      function Content({ transitionSettled }: { transitionSettled: boolean }) {
        return <Text testID="content">{String(transitionSettled)}</Text>;
      },
  };
});

beforeEach(() => {
  jest.useFakeTimers();
  parentListeners.clear();
});
afterEach(() => jest.useRealTimers());

it('settles on the parent stack opening transition, not on the fallback', async () => {
  const view = await render(<ActivityDetailRoute />);
  await act(() => jest.advanceTimersByTime(260));
  await act(() => jest.advanceTimersByTime(100));
  expect(view.getByTestId('content').props.children).toBe('false');

  await act(() => parentListeners.get('transitionEnd')?.({ data: { closing: false } }));
  expect(view.getByTestId('content').props.children).toBe('true');
});
