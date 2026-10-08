/**
 * Scenario: an athlete reads the backup slide of the App Tour and wants
 * automatic backup on.
 *
 * Expected behaviour: the slide carries the same Automatic backup switch as
 * the backup settings screen, reading and writing the one setting, so turning
 * it on in the tour is turning it on.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import { BackupSlide } from '@/features/settings/components/whatsNew/BackupSlide';
import { isAutoBackupEnabled, setAutoBackupEnabled } from '@/features/settings/lib/autobackup';

const mockSettings = new Map<string, string>();

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
  }),
}));

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

// The slide reaches the app barrel for `useTheme`, and the barrel pulls the
// IAP binding in behind it.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

beforeEach(() => {
  mockSettings.clear();
});

describe('the backup tour slide', () => {
  it('turns automatic backup on through the setting the backup screen reads', () => {
    const { getByTestId } = render(<BackupSlide />);
    const toggle = getByTestId('tour-backup-auto-switch');

    expect(toggle.props.value).toBe(false);
    fireEvent(toggle, 'valueChange', true);

    expect(isAutoBackupEnabled()).toBe(true);
    expect(getByTestId('tour-backup-auto-switch').props.value).toBe(true);
  });

  it('shows the switch on when automatic backup is already on, and turns it off', () => {
    setAutoBackupEnabled(true);
    const { getByTestId } = render(<BackupSlide />);
    const toggle = getByTestId('tour-backup-auto-switch');

    expect(toggle.props.value).toBe(true);
    fireEvent(toggle, 'valueChange', false);

    expect(isAutoBackupEnabled()).toBe(false);
    expect(getByTestId('tour-backup-auto-switch').props.value).toBe(false);
  });
});
