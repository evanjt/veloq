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
import { fireEvent, render } from '@testing-library/react-native';

import { ActivitySyncRow } from '@/features/settings/components/ActivitySyncRow';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));

let mockStatus: { state: string; completed: number; total: number } | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => mockStatus,
}));

const cancelSync = jest.fn();
let mockEngine: { cancelSync: jest.Mock } | null = null;
jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngine,
}));

describe('ActivitySyncRow', () => {
  beforeEach(() => {
    cancelSync.mockClear();
    mockEngine = { cancelSync };
    mockStatus = null;
  });

  it('renders nothing before the engine has reported a status', () => {
    const { queryByTestId } = render(<ActivitySyncRow />);
    expect(queryByTestId('sync-stop-button')).toBeNull();
  });

  it.each(['idle', 'paused', 'authExpired'])('renders nothing while the state is %s', (state) => {
    mockStatus = { state, completed: 0, total: 0 };
    const { queryByTestId } = render(<ActivitySyncRow />);
    expect(queryByTestId('sync-stop-button')).toBeNull();
  });

  it('offers a stop control while the sync runs', () => {
    mockStatus = { state: 'syncing', completed: 3, total: 40 };
    const { getByTestId } = render(<ActivitySyncRow />);
    expect(getByTestId('sync-stop-button')).toBeTruthy();
    expect(getByTestId('sync-progress-label').props.children).toContain(
      'settings.syncActivitiesProgress:{"completed":3,"total":40}'
    );
  });

  it('names the sync without counts before the total is known', () => {
    mockStatus = { state: 'syncing', completed: 0, total: 0 };
    const { getByTestId } = render(<ActivitySyncRow />);
    expect(getByTestId('sync-progress-label').props.children).toContain('settings.syncActivities');
  });

  it('cancels the engine sync when the stop control is pressed', () => {
    mockStatus = { state: 'syncing', completed: 1, total: 9 };
    const { getByTestId } = render(<ActivitySyncRow />);
    fireEvent.press(getByTestId('sync-stop-button'));
    expect(cancelSync).toHaveBeenCalledTimes(1);
  });

  it('reads as stopping and refuses a second press until the engine settles', () => {
    mockStatus = { state: 'syncing', completed: 1, total: 9 };
    const { getByTestId } = render(<ActivitySyncRow />);
    fireEvent.press(getByTestId('sync-stop-button'));
    fireEvent.press(getByTestId('sync-stop-button'));
    expect(cancelSync).toHaveBeenCalledTimes(1);
    expect(getByTestId('sync-stop-label').props.children).toBe('settings.syncStopping');
  });

  it('re-arms the stop control for the sync after the cancelled one settles', () => {
    mockStatus = { state: 'syncing', completed: 1, total: 9 };
    const { getByTestId, rerender } = render(<ActivitySyncRow />);
    fireEvent.press(getByTestId('sync-stop-button'));

    mockStatus = { state: 'idle', completed: 1, total: 9 };
    rerender(<ActivitySyncRow />);

    mockStatus = { state: 'syncing', completed: 0, total: 12 };
    rerender(<ActivitySyncRow />);
    expect(getByTestId('sync-stop-label').props.children).toBe('settings.syncStop');

    fireEvent.press(getByTestId('sync-stop-button'));
    expect(cancelSync).toHaveBeenCalledTimes(2);
  });

  it('survives a press with no engine handle', () => {
    mockEngine = null;
    mockStatus = { state: 'syncing', completed: 1, total: 9 };
    const { getByTestId } = render(<ActivitySyncRow />);
    expect(() => fireEvent.press(getByTestId('sync-stop-button'))).not.toThrow();
  });
});
