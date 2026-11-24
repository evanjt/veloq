/**
 * Scenario: a first sync of ten years of history runs for minutes, and the only
 * way out was to kill the app. The engine has held a soft cancel since
 * `objects/sync.rs`, and `EngineClient.cancelSync` has reached it since the
 * client was written, but nothing in the UI ever called either.
 *
 * Expected behaviour: while the engine reports `syncing` the row names the sync
 * and offers a stop control, pressing it calls `cancelSync` once, and the row
 * says it is stopping until the engine leaves `syncing`. An idle, paused or
 * errored sync has nothing to stop, so the row renders nothing.
 */

import React from 'react';
import { SyncState, FfiSyncStep } from 'veloqrs';
import { fireEvent, render } from '@testing-library/react-native';

import { ActivitySyncRow } from '@/features/settings/components/ActivitySyncRow';

// The real cancel delegate over a host that is open only while `mockEngine` is
// set, so a press with the engine closed reaches the delegate's own guard.
jest.mock('veloqrs', () => {
  const { bindDelegates } = require('../../../../modules/veloqrs/src/delegates/bind');
  const syncDelegates = require('../../../../modules/veloqrs/src/delegates/sync');
  const host = {
    get ready() {
      return mockEngine !== null;
    },
    engine: { sync: () => ({ cancel: () => mockEngine?.cancelSync() }) },
    timed: (_name: string, run: () => unknown) => run(),
    notify: () => {},
  };
  return require('../../__shared__/veloqrsStub').withOverrides({
    sync: bindDelegates(host, syncDelegates),
  });
});

jest.mock('react-i18next', () => require('../../__shared__/i18nMock').keysWithValues());

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
// The library figure is its own suite. Here it reports nothing, which is what
// an engine that has never synced answers anyway.
jest.mock('@/shared/native/useLibraryCoverage', () => ({
  useLibraryCoverage: () => null,
}));

let mockStatus: {
  state: SyncState;
  completed: number;
  total: number;
  step?: FfiSyncStep;
} | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => mockStatus,
}));

const cancelSync = jest.fn();
let mockEngine: { cancelSync: jest.Mock } | null = null;

describe('ActivitySyncRow', () => {
  beforeEach(() => {
    cancelSync.mockClear();
    mockEngine = { cancelSync };
    mockStatus = null;
  });

  vaultIt('renders nothing before the engine has reported a status', async () => {
    const { queryByTestId } = await render(<ActivitySyncRow />);
    expect(queryByTestId('sync-stop-button')).toBeNull();
  });

  vaultIt.each([SyncState.Idle, SyncState.Paused, SyncState.AuthExpired])(
    'renders nothing while the state is %s',
    async (state) => {
      mockStatus = { state, completed: 0, total: 0 };
      const { queryByTestId } = await render(<ActivitySyncRow />);
      expect(queryByTestId('sync-stop-button')).toBeNull();
    }
  );

  vaultIt('offers a stop control while the sync runs', async () => {
    mockStatus = { state: SyncState.Syncing, completed: 3, total: 8, step: FfiSyncStep.Census };
    const { getByTestId } = await render(<ActivitySyncRow />);
    expect(getByTestId('sync-stop-button')).toBeTruthy();
    expect(getByTestId('sync-progress-label').props.children).toContain(
      'settings.syncStepProgress:{"label":"settings.syncStep.census","completed":3,"total":8}'
    );
  });

  vaultIt('names the sync without a step before the engine reports one', async () => {
    mockStatus = { state: SyncState.Syncing, completed: 0, total: 0 };
    const { getByTestId } = await render(<ActivitySyncRow />);
    expect(getByTestId('sync-progress-label').props.children).toContain('settings.syncActivities');
  });

  it('cancels the engine sync when the stop control is pressed', async () => {
    mockStatus = { state: SyncState.Syncing, completed: 1, total: 9 };
    const { getByTestId } = await render(<ActivitySyncRow />);
    await fireEvent.press(getByTestId('sync-stop-button'));
    expect(cancelSync).toHaveBeenCalledTimes(1);
  });

  it('reads as stopping and refuses a second press until the engine settles', async () => {
    mockStatus = { state: SyncState.Syncing, completed: 1, total: 9 };
    const { getByTestId } = await render(<ActivitySyncRow />);
    await fireEvent.press(getByTestId('sync-stop-button'));
    await fireEvent.press(getByTestId('sync-stop-button'));
    expect(cancelSync).toHaveBeenCalledTimes(1);
    expect(getByTestId('sync-stop-label').props.children).toBe('settings.syncStopping');
  });

  it('re-arms the stop control for the sync after the cancelled one settles', async () => {
    mockStatus = { state: SyncState.Syncing, completed: 1, total: 9 };
    const { getByTestId, rerender } = await render(<ActivitySyncRow />);
    await fireEvent.press(getByTestId('sync-stop-button'));

    mockStatus = { state: SyncState.Idle, completed: 1, total: 9 };
    await rerender(<ActivitySyncRow />);

    mockStatus = { state: SyncState.Syncing, completed: 0, total: 12 };
    await rerender(<ActivitySyncRow />);
    expect(getByTestId('sync-stop-label').props.children).toBe('settings.syncStop');

    await fireEvent.press(getByTestId('sync-stop-button'));
    expect(cancelSync).toHaveBeenCalledTimes(2);
  });

  it('survives a press with the engine closed', async () => {
    mockEngine = null;
    mockStatus = { state: SyncState.Syncing, completed: 1, total: 9 };
    const { getByTestId } = await render(<ActivitySyncRow />);
    await expect(
      (async () => fireEvent.press(getByTestId('sync-stop-button')))()
    ).resolves.not.toThrow();
  });
});
