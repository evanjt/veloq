/**
 * Scenario: an on-demand body ends its wait without landing. A Retry was
 * offered on any ended wait, including a request the engine refused because
 * the device is offline or nobody is signed in, where tapping it cannot work.
 *
 * Expected behaviour: offline and signed out each say what will fix it and
 * offer no Retry. A wait that ran out, or a start that threw, still offers one.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { BodyNotDownloaded } from '@/shared/ui/BodyNotDownloaded';
import type { EngineBodyStatus } from '@/shared/native/engineBodies';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

jest.mock('@/shared/ui/Button', () => {
  const { Pressable, Text } = require('react-native');
  return {
    Button: ({
      label,
      onPress,
      testID,
    }: {
      label: string;
      onPress: () => void;
      testID: string;
    }) => (
      <Pressable onPress={onPress} testID={testID}>
        <Text>{label}</Text>
      </Pressable>
    ),
  };
});

function renderBlock(status: EngineBodyStatus, onRetry = jest.fn()) {
  return render(
    <BodyNotDownloaded
      message="curve.notDownloaded"
      status={status}
      onRetry={onRetry}
      testID="curve-body"
    />
  );
}

it('says to sign in and offers no Retry when there is no credential', async () => {
  const view = await renderBlock('notConfigured');

  expect(view.getByText('curve.notDownloaded')).toBeTruthy();
  expect(view.getByText('settings.streamBackfillRefusedNotConfigured')).toBeTruthy();
  expect(view.queryByTestId('curve-body-retry')).toBeNull();
});

it('says it comes down once connected and offers no Retry while offline', async () => {
  const view = await renderBlock('offline');

  expect(view.getByText('refresh.offline')).toBeTruthy();
  expect(view.queryByTestId('curve-body-retry')).toBeNull();
});

it.each<EngineBodyStatus>(['timedOut', 'refused'])(
  'offers a Retry once a %s wait ends',
  async (s) => {
    const onRetry = jest.fn();
    const view = await renderBlock(s, onRetry);

    await fireEvent.press(view.getByTestId('curve-body-retry'));

    expect(onRetry).toHaveBeenCalledTimes(1);
    expect(view.queryByText('refresh.offline')).toBeNull();
    expect(view.queryByText('settings.streamBackfillRefusedNotConfigured')).toBeNull();
  }
);

it.each<EngineBodyStatus>(['waiting', 'idle'])('offers nothing while the wait is %s', async (s) => {
  const view = await renderBlock(s);

  expect(view.queryByTestId('curve-body-retry')).toBeNull();
  expect(view.queryByText('refresh.offline')).toBeNull();
});
