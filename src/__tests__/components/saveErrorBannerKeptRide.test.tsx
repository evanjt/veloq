/**
 * Scenario: the server refused a saved ride, so retrying the same bytes cannot
 * succeed and the ride stays on the device.
 *
 * Expected behaviour: the banner shows the server's words beneath the message,
 * offers the kept ride to open and to share, and offers no Retry.
 */
import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { SaveErrorBanner } from '@/features/recording/components/SaveErrorBanner';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/ui/useAnnounceOnAppear', () => ({ useAnnounceOnAppear: () => {} }));

it('offers the kept ride to open and share, with the server detail beneath', () => {
  const onOpen = jest.fn();
  const onShare = jest.fn();
  const { getByText, getByTestId, queryByText } = render(
    <SaveErrorBanner
      errorMessage="recording.uploadRejected"
      detail="Duplicate lantern log"
      showPermissionFix={false}
      isOAuthLoading={false}
      onUpgradePermissions={() => {}}
      onOpenRecording={onOpen}
      onShareFit={onShare}
    />
  );

  expect(getByText('recording.uploadRejected')).toBeTruthy();
  expect(getByText('Duplicate lantern log')).toBeTruthy();
  expect(queryByText('common.retry')).toBeNull();

  fireEvent.press(getByTestId('save-error-open-recording'));
  fireEvent.press(getByTestId('save-error-share-fit'));
  expect(onOpen).toHaveBeenCalledTimes(1);
  expect(onShare).toHaveBeenCalledTimes(1);
});

it('shows neither action nor detail when none is given', () => {
  const { queryByTestId, toJSON } = render(
    <SaveErrorBanner
      errorMessage="recording.uploadMissing"
      showPermissionFix={false}
      isOAuthLoading={false}
      onUpgradePermissions={() => {}}
    />
  );

  expect(queryByTestId('save-error-open-recording')).toBeNull();
  expect(queryByTestId('save-error-share-fit')).toBeNull();
  expect(JSON.stringify(toJSON())).not.toContain('common.retry');
});
