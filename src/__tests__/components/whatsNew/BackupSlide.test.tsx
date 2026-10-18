/**
 * Scenario: the tour is where automatic backup is asked for. The slide says
 * what a backup holds and where it goes, and offers Turn on and Never remind me
 * again.
 *
 * Expected behaviour: Turn on turns automatic backup on and writes the first
 * backup at once, as the switch in Settings does, rather than leaving it to the
 * schedule's next trigger. Never remind me again stores the answer and turns
 * nothing on, so the tour's leftover card does not offer backup again.
 */

import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { BackupSlide } from '@/features/settings/components/whatsNew/BackupSlide';
import { isAutoBackupEnabled, setAutoBackupEnabled } from '@/features/settings/lib/autobackup';
import { NO_TOUR_OFFER, afterTourClosed, tourOffer } from '@/features/settings/lib/tourOffer';
import { useWhatsNewStore } from '@/features/settings/stores/WhatsNewStore';

const mockSettings = new Map<string, string>();
const mockRunRecordBackup = jest.fn(async (_path: string) => {});

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => ({
    getSetting: (key: string) => mockSettings.get(key),
    setSetting: (key: string, value: string) => mockSettings.set(key, value),
    deleteSetting: (key: string) => mockSettings.delete(key),
    engineInstall: () => 1,
    runRecordBackup: (path: string) => mockRunRecordBackup(path),
    getBackupMetadata: () => ({ schema_version: '14', activity_count: '1', athlete_id: 'i1' }),
  }),
}));

// No destination beyond the device backup, which every run writes.
jest.mock('@/features/settings/lib/autobackup/backends/carriers', () => ({
  backupCarriers: [],
}));

jest.mock('expo-file-system/legacy', () => ({
  ...jest.requireActual('expo-file-system/legacy'),
  cacheDirectory: 'file:///cache/',
  documentDirectory: 'file:///docs/',
  getInfoAsync: jest.fn().mockResolvedValue({ exists: true, size: 4096 }),
  deleteAsync: jest.fn().mockResolvedValue(undefined),
}));

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/storage', () => ({
  getSetting: jest.fn().mockResolvedValue(null),
  setSetting: jest.fn().mockResolvedValue(undefined),
}));
jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub').withOverrides());

// The slide reaches the app barrel for `useTheme`, and the barrel pulls the
// IAP binding in behind it.
jest.mock('react-native-iap', () => ({ useIAP: () => ({}), ErrorCode: {} }));

const answer = () => useWhatsNewStore.getState().tourOffer.answers.backup;

async function press(testID: string): Promise<void> {
  await act(async () => {
    fireEvent.press(screen.getByTestId(testID));
  });
}

/** The first backup is written asynchronously, so "it started" is a wait. */
async function untilBackupWritten(): Promise<void> {
  for (let i = 0; i < 100 && mockRunRecordBackup.mock.calls.length === 0; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

beforeEach(() => {
  mockSettings.clear();
  mockRunRecordBackup.mockClear();
  useWhatsNewStore.setState({ tourOffer: NO_TOUR_OFFER });
});

it('says what a backup holds and where it goes', async () => {
  await render(<BackupSlide />);

  expect(screen.getByTestId('tour-backup-holds')).toHaveTextContent('backup.backupHolds');
  expect(screen.getByTestId('tour-backup-where')).toHaveTextContent(
    'whatsNew.tutorial.backupWhere'
  );
});

describe('Turn on', () => {
  it('turns automatic backup on and writes the first backup at once', async () => {
    await render(<BackupSlide />);
    await press('tour-backup-turn-on');
    await untilBackupWritten();

    expect(isAutoBackupEnabled()).toBe(true);
    expect(mockRunRecordBackup).toHaveBeenCalledTimes(1);
    expect(answer()).toBe('on');
    expect(screen.queryByTestId('tour-backup-turn-on')).toBeNull();
    expect(screen.getByText('whatsNew.tutorial.backupOn')).toBeTruthy();
  });
});

describe('Never remind me again', () => {
  it('stores the answer, turns nothing on, and offers no buttons again', async () => {
    await render(<BackupSlide />);
    await press('tour-backup-never');

    expect(answer()).toBe('never');
    expect(isAutoBackupEnabled()).toBe(false);
    expect(mockRunRecordBackup).not.toHaveBeenCalled();
    expect(screen.queryByTestId('tour-backup-turn-on')).toBeNull();
    expect(screen.getByText('whatsNew.tutorial.backupLater')).toBeTruthy();
  });

  it('keeps the leftover card from offering backup', async () => {
    await render(<BackupSlide />);
    await press('tour-backup-never');

    const offer = tourOffer({
      tourEligible: true,
      lastSeenVersion: '0.4.0',
      record: afterTourClosed(useWhatsNewStore.getState().tourOffer),
      settledThisSession: false,
      tourSetupSlides: ['backup'],
    });
    expect(offer).toBeNull();
  });

  it('holds when the tour is opened again', async () => {
    useWhatsNewStore.setState({ tourOffer: { ...NO_TOUR_OFFER, answers: { backup: 'never' } } });
    await render(<BackupSlide />);

    expect(screen.queryByTestId('tour-backup-turn-on')).toBeNull();
    expect(screen.queryByTestId('tour-backup-never')).toBeNull();
  });
});

it('swiped past, records no answer and turns nothing on', async () => {
  await render(<BackupSlide />);

  expect(answer()).toBeUndefined();
  expect(isAutoBackupEnabled()).toBe(false);
});

it('offers no buttons when automatic backup is already on', async () => {
  setAutoBackupEnabled(true);
  await render(<BackupSlide />);

  expect(screen.queryByTestId('tour-backup-turn-on')).toBeNull();
  expect(screen.getByText('whatsNew.tutorial.backupOn')).toBeTruthy();
  expect(mockRunRecordBackup).not.toHaveBeenCalled();
});
