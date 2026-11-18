/**
 * Scenario: the athlete turns the Apple Watch link on from the notifications spoke.
 * Expected behaviour: the row reads the link's state, pressing it switches the link through the
 * watch module, and the row is absent where the module is not present.
 */

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';

import { WatchLinkRow } from '@/features/settings/components/WatchLinkRow';

const mockLink = {
  isWatchLinkAvailable: jest.fn(),
  isWatchLinkEnabled: jest.fn(),
  setWatchLinkEnabled: jest.fn(),
};
jest.mock('@/shared/native/watchLink', () => ({
  isWatchLinkAvailable: () => mockLink.isWatchLinkAvailable(),
  isWatchLinkEnabled: () => mockLink.isWatchLinkEnabled(),
  setWatchLinkEnabled: (on: boolean) => mockLink.setWatchLinkEnabled(on),
}));
jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());

beforeEach(() => {
  mockLink.isWatchLinkAvailable.mockReset().mockReturnValue(true);
  mockLink.isWatchLinkEnabled.mockReset().mockReturnValue(false);
  mockLink.setWatchLinkEnabled.mockReset();
});

describe('WatchLinkRow', () => {
  it('switches the link on when pressed', async () => {
    await render(<WatchLinkRow />);

    await fireEvent.press(screen.getByTestId('watch-link-switch'));

    expect(mockLink.setWatchLinkEnabled).toHaveBeenCalledTimes(1);
    expect(mockLink.setWatchLinkEnabled).toHaveBeenCalledWith(true);
  });

  it('switches the link off when it is on', async () => {
    mockLink.isWatchLinkEnabled.mockReturnValue(true);
    await render(<WatchLinkRow />);

    await fireEvent.press(screen.getByTestId('watch-link-switch'));

    expect(mockLink.setWatchLinkEnabled).toHaveBeenCalledWith(false);
  });

  it('renders nothing without the watch module', async () => {
    mockLink.isWatchLinkAvailable.mockReturnValue(false);
    await render(<WatchLinkRow />);

    expect(screen.queryByTestId('watch-link-switch')).toBeNull();
  });
});
