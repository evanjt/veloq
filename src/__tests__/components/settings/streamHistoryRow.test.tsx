/**
 * Scenario: `Q31` asked for a control over how much stream history the athlete
 * keeps, a readout of what it costs, a 90 day default and a reset that clears
 * the excess. `B132` built the store and its window in Rust; nothing rendered
 * either.
 *
 * Expected behaviour: the row reads the engine's window rather than a local
 * copy, a fresh install reads 90 days, choosing a window writes it once and
 * re-reads the size the eviction left behind, reset returns to 90, and the
 * activity `retentionDays` in `RouteSettingsStore` is never written. That last
 * one deletes whole activities and is a different setting with a similar name.
 */

import React from 'react';
import { fireEvent, render } from '@testing-library/react-native';

import {
  StreamHistoryRow,
  STREAM_RETENTION_CHOICES_DAYS,
} from '@/features/settings/components/StreamHistoryRow';
import { DEFAULT_STREAM_RETENTION_DAYS } from '@/features/settings/lib/streamRetention';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars && typeof vars.count === 'number' ? `${key}:${vars.count}` : key,
  }),
}));

const setStreamRetentionDays = jest.fn();
const mockUpdateRouteSettings = jest.fn();

let stored: number | undefined = DEFAULT_STREAM_RETENTION_DAYS;
let bytes = 4 * 1024 * 1024;
let mockEngineHandle: object | null = null;

jest.mock('@/shared/native/engine', () => ({
  getEngine: () => mockEngineHandle,
}));

jest.mock('@/features/routes/stores/EngineStatusStore', () => ({
  useEngineStatus: (pick: (s: { readyNonce: number }) => unknown) => pick({ readyNonce: 0 }),
}));

jest.mock('@/features/routes/stores/RouteSettingsStore', () => ({
  useRouteSettings: () => ({
    settings: { retentionDays: 0 },
    updateSettings: mockUpdateRouteSettings,
  }),
}));

function buildEngine() {
  return {
    streamRetentionDays: () => stored,
    setStreamRetentionDays: (days: number) => {
      setStreamRetentionDays(days);
      stored = days;
      // The engine prunes on the way in, so the store costs what the window
      // is worth: a narrower one drops, a wider one refills.
      bytes = days === 0 ? 9 * 1024 * 1024 : (days / 90) * 4 * 1024 * 1024;
    },
    streamStoreBytes: () => bytes,
  };
}

describe('StreamHistoryRow', () => {
  beforeEach(() => {
    setStreamRetentionDays.mockClear();
    mockUpdateRouteSettings.mockClear();
    stored = DEFAULT_STREAM_RETENTION_DAYS;
    bytes = 4 * 1024 * 1024;
    mockEngineHandle = buildEngine();
  });

  it('reads 90 days from an install that has never chosen', () => {
    const { getByTestId } = render(<StreamHistoryRow isDark={false} />);
    expect(getByTestId('settings-stream-window').props.children).toBe(
      `settings.streamHistoryDays:${DEFAULT_STREAM_RETENTION_DAYS} ›`
    );
  });

  it('shows what the store holds', () => {
    const { getByTestId } = render(<StreamHistoryRow isDark={false} />);
    expect(getByTestId('settings-stream-bytes').props.children).toBe('4.0 MB');
  });

  it('writes the next window once and re-reads the size the eviction left', () => {
    const { getByTestId } = render(<StreamHistoryRow isDark={false} />);
    const next =
      STREAM_RETENTION_CHOICES_DAYS[
        (STREAM_RETENTION_CHOICES_DAYS.indexOf(DEFAULT_STREAM_RETENTION_DAYS) + 1) %
          STREAM_RETENTION_CHOICES_DAYS.length
      ];
    fireEvent.press(getByTestId('settings-stream-window'));
    expect(setStreamRetentionDays).toHaveBeenCalledTimes(1);
    expect(setStreamRetentionDays).toHaveBeenCalledWith(next);
    expect(getByTestId('settings-stream-bytes').props.children).toBe('8.0 MB');
  });

  it('shrinking the window drops the readout', () => {
    stored = 365;
    bytes = 16 * 1024 * 1024;
    const { getByTestId } = render(<StreamHistoryRow isDark={false} />);
    expect(getByTestId('settings-stream-bytes').props.children).toBe('16.0 MB');
    fireEvent.press(getByTestId('settings-stream-reset'));
    expect(getByTestId('settings-stream-bytes').props.children).toBe('4.0 MB');
  });

  it('cycles through every choice and comes back to where it started', () => {
    const { getByTestId } = render(<StreamHistoryRow isDark={false} />);
    for (let i = 0; i < STREAM_RETENTION_CHOICES_DAYS.length; i += 1) {
      fireEvent.press(getByTestId('settings-stream-window'));
    }
    expect(stored).toBe(DEFAULT_STREAM_RETENTION_DAYS);
    expect(setStreamRetentionDays).toHaveBeenCalledTimes(STREAM_RETENTION_CHOICES_DAYS.length);
  });

  it('names the widest window rather than printing zero days', () => {
    stored = 0;
    const { getByTestId } = render(<StreamHistoryRow isDark={false} />);
    expect(getByTestId('settings-stream-window').props.children).toBe(
      'settings.streamHistoryAll ›'
    );
  });

  it('offers a reset only when the window is not the default', () => {
    const { getByTestId, queryByTestId, rerender } = render(<StreamHistoryRow isDark={false} />);
    expect(queryByTestId('settings-stream-reset')).toBeNull();
    stored = 365;
    rerender(<StreamHistoryRow isDark={false} />);
    fireEvent.press(getByTestId('settings-stream-window'));
    setStreamRetentionDays.mockClear();
    expect(queryByTestId('settings-stream-reset')).not.toBeNull();
  });

  it('reset returns to 90 days, which is what clears the excess', () => {
    stored = 0;
    const { getByTestId } = render(<StreamHistoryRow isDark={false} />);
    fireEvent.press(getByTestId('settings-stream-reset'));
    expect(setStreamRetentionDays).toHaveBeenCalledWith(DEFAULT_STREAM_RETENTION_DAYS);
    expect(stored).toBe(DEFAULT_STREAM_RETENTION_DAYS);
  });

  it('never writes the activity retention setting, which deletes whole activities', () => {
    const { getByTestId } = render(<StreamHistoryRow isDark={false} />);
    fireEvent.press(getByTestId('settings-stream-window'));
    fireEvent.press(getByTestId('settings-stream-window'));
    expect(mockUpdateRouteSettings).not.toHaveBeenCalled();
  });

  it('renders nothing when the engine cannot answer', () => {
    mockEngineHandle = null;
    const { queryByTestId } = render(<StreamHistoryRow isDark={false} />);
    expect(queryByTestId('settings-stream-history')).toBeNull();
  });

  it('renders nothing while the engine is open but unready, rather than the default', () => {
    stored = undefined;
    const { queryByTestId } = render(<StreamHistoryRow isDark={false} />);
    expect(queryByTestId('settings-stream-history')).toBeNull();
  });
});
