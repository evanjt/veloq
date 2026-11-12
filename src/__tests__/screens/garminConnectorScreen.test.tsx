/**
 * Scenario: an athlete opens the Garmin connector, reads why it is offered and
 * pastes a key.
 *
 * Expected behaviour: the explanation links the forum thread that tracks the
 * data-sharing change, no key expiry field is shown, and connecting writes no
 * expiry setting.
 */

import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react-native';
import { GarminKeyStatus } from 'veloqrs';

import { GarminConnector } from '@/features/settings/components/GarminConnector';
import {
  GARMIN_FORUM_THREAD,
  readGarminConnectorState,
} from '@/features/settings/lib/garminConnector';
import { openExternal } from '@/shared/app/openExternal';
import { setSetting } from '@/shared/storage';
import { useAuthStore } from '@/shared/app/AuthStore';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app/openExternal', () => ({ openExternal: jest.fn() }));
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/useAthlete', () => ({ useAthlete: () => ({ data: null }) }));
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
  removeSetting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('@/features/recording', () => ({
  usePermissionUpgrade: () => ({ upgradePermissions: jest.fn() }),
  useWriteAccessMissing: () => false,
}));
jest.mock('@/features/settings/lib/garminConnector', () => ({
  ...jest.requireActual('@/features/settings/lib/garminConnector'),
  readGarminConnectorState: jest.fn().mockResolvedValue('off'),
  readGarminAccount: jest.fn().mockResolvedValue(undefined),
  connectGarminKey: jest.fn().mockResolvedValue(0),
}));

describe('the Garmin connector screen', () => {
  beforeEach(() => jest.clearAllMocks());

  it('opens the forum thread from the Read more link', async () => {
    const screen = render(<GarminConnector />);
    fireEvent.press(await screen.findByTestId('garmin-read-more'));
    expect(openExternal).toHaveBeenCalledWith(GARMIN_FORUM_THREAD);
    expect(GARMIN_FORUM_THREAD).toBe(
      'https://forum.intervals.icu/t/api-access-to-intervals-icu/609/75'
    );
  });

  it('shows no key expiry field and writes no expiry when a key connects', async () => {
    expect(GarminKeyStatus.Connected).toBe(0);
    const screen = render(<GarminConnector />);
    expect(screen.queryByTestId('garmin-expiry-input')).toBeNull();
    fireEvent.changeText(await screen.findByTestId('garmin-key-input'), 'abc');
    fireEvent.press(screen.getByTestId('garmin-connect'));
    await waitFor(() => expect(screen.queryByTestId('garmin-disconnect')).not.toBeNull());
    const written = (setSetting as jest.Mock).mock.calls.map(([key]) => key);
    expect(written).not.toContain('veloq-garmin-key-expiry');
  });

  describe('as the only source', () => {
    beforeEach(() => {
      useAuthStore.setState({ authMethod: 'garmin', athleteId: 'garmin:8841' });
      (readGarminConnectorState as jest.Mock).mockResolvedValue('connected');
    });
    afterEach(() => {
      useAuthStore.setState({ authMethod: null, athleteId: null });
      (readGarminConnectorState as jest.Mock).mockResolvedValue('off');
    });

    it('offers nothing that belongs to an intervals.icu account', async () => {
      const screen = render(<GarminConnector />);
      await screen.findByTestId('garmin-feed-switch');
      expect(screen.queryByTestId('garmin-read-more')).toBeNull();
      expect(screen.queryByTestId('garmin-more-options')).toBeNull();
      expect(screen.queryByTestId('garmin-upload-switch')).toBeNull();
      expect(screen.queryByTestId('garmin-auto-swap-switch')).toBeNull();
      expect(screen.queryByTestId('garmin-duplicate-warning')).toBeNull();
    });

    it('leaves disconnecting to signing out, which ends the session the key is', async () => {
      const screen = render(<GarminConnector />);
      await screen.findByTestId('garmin-feed-switch');
      expect(screen.queryByTestId('garmin-disconnect')).toBeNull();
    });
  });

  it('still offers the intervals.icu options beside an intervals.icu account', async () => {
    useAuthStore.setState({ authMethod: 'apiKey', athleteId: 'i77' });
    (readGarminConnectorState as jest.Mock).mockResolvedValue('connected');
    const screen = render(<GarminConnector />);
    await screen.findByTestId('garmin-feed-switch');
    expect(screen.queryByTestId('garmin-more-options')).not.toBeNull();
    expect(screen.queryByTestId('garmin-disconnect')).not.toBeNull();
    useAuthStore.setState({ authMethod: null, athleteId: null });
    (readGarminConnectorState as jest.Mock).mockResolvedValue('off');
  });
});
