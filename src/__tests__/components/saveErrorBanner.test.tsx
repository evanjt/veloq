/**
 * Scenario: a ride's save fails on a device that is nearly full. Retrying
 * fails the same way until space is freed.
 *
 * Expected behaviour: the banner offers a way to free space beside Retry, and
 * offers it only when the save says the device is short.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SaveErrorBanner } from '@/features/recording/components/SaveErrorBanner';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());

function renderBanner(onFreeSpace?: () => void) {
  const onRetry = jest.fn();
  const view = render(
    <SaveErrorBanner
      errorMessage="recording.saveErrorNoSpace"
      showPermissionFix={false}
      isOAuthLoading={false}
      onUpgradePermissions={jest.fn()}
      onRetry={onRetry}
      onFreeSpace={onFreeSpace}
    />
  );
  return { ...view, onRetry };
}

describe('SaveErrorBanner', () => {
  it('offers to free space and keeps Retry', () => {
    const onFreeSpace = jest.fn();
    const { getByText, onRetry } = renderBanner(onFreeSpace);

    fireEvent.press(getByText('common.freeUpSpace'));
    fireEvent.press(getByText('common.retry'));

    expect(onFreeSpace).toHaveBeenCalledTimes(1);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it('offers no space action when the device has room', () => {
    const { queryByText, getByText } = renderBanner(undefined);

    expect(queryByText('common.freeUpSpace')).toBeNull();
    expect(getByText('common.retry')).toBeTruthy();
  });
});
