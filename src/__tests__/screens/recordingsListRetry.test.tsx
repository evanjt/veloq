/**
 * Scenario: a ride recorded without the upload scope is saved `localOnly`, and
 * an upload that fails leaves the entry `failed`. Both sit in the recordings
 * list, and the only way to send either was to open the recording and find the
 * button on the detail screen.
 *
 * Expected behaviour: the row carries the retry itself, on the same rule the
 * detail screen uses, and it requeues through the one upload path rather than a
 * second one. A row already uploaded offers nothing, and a row in flight shows
 * that rather than a second press.
 */

import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';

import RecordingsLibraryScreen from '@/app/recordings/index';
import type { RecordingLibraryEntry, RecordingUploadStatus } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

jest.mock('react-i18next', () => require('../__shared__/i18nMock').fallbackOrKey());

jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));

jest.mock('@/shared/ui', () => {
  const { View, Text } = require('react-native');
  return {
    ScreenSafeAreaView: View,
    useBottomClearance: () => 0,
    useScrollEndInset: () => 0,
    EmptyState: ({ title }: { title: string }) => <Text>{title}</Text>,
  };
});

jest.mock('@/features/recording/components/PermissionUpgradeBanner', () => ({
  PermissionUpgradeBanner: () => null,
}));

const mockUploadNow = jest.fn();
const mockLibrary: { entries: RecordingLibraryEntry[]; uploadingId: string | null } = {
  entries: [],
  uploadingId: null,
};

jest.mock('@/features/recording/hooks/useRecordingLibrary', () => ({
  useRecordingLibrary: () => ({
    entries: mockLibrary.entries,
    isLoading: false,
    uploadingId: mockLibrary.uploadingId,
    uploadNow: mockUploadNow,
    remove: jest.fn(),
    refresh: jest.fn(),
  }),
}));

function entry(id: string, uploadStatus: RecordingUploadStatus): RecordingLibraryEntry {
  return {
    id,
    name: `Ride ${id}`,
    activityType: 'Ride',
    startTime: Date.UTC(2026, 8, 12, 6, 0, 0),
    durationSeconds: 3600,
    distanceMeters: 30000,
    createdAt: Date.UTC(2026, 8, 12, 7, 0, 0),
    uploadStatus,
    retryCount: 0,
  } as unknown as RecordingLibraryEntry;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLibrary.entries = [];
  mockLibrary.uploadingId = null;
});

describe('the recordings list', () => {
  it.each<RecordingUploadStatus>(['localOnly', 'failed', 'permissionBlocked', 'pending'])(
    'offers a retry on a %s row',
    async (status) => {
      mockLibrary.entries = [entry('r1', status)];

      await render(<RecordingsLibraryScreen />);

      expect(screen.getByTestId('recording-retry-r1')).toBeTruthy();
    }
  );

  it('offers no retry once the recording is uploaded', async () => {
    mockLibrary.entries = [entry('r1', 'uploaded')];

    await render(<RecordingsLibraryScreen />);

    expect(screen.queryByTestId('recording-retry-r1')).toBeNull();
  });

  it('requeues through the library upload path when the retry is pressed', async () => {
    mockLibrary.entries = [entry('r1', 'failed')];

    await render(<RecordingsLibraryScreen />);
    await fireEvent.press(screen.getByTestId('recording-retry-r1'));

    await waitFor(() => expect(mockUploadNow).toHaveBeenCalledWith('r1'));
    expect(mockUploadNow).toHaveBeenCalledTimes(1);
  });

  /** An upload in flight is not a second press: the row says so instead. */
  it('shows the upload running rather than a retry while it is in flight', async () => {
    mockLibrary.entries = [entry('r1', 'failed')];
    mockLibrary.uploadingId = 'r1';

    await render(<RecordingsLibraryScreen />);

    expect(screen.queryByTestId('recording-retry-r1')).toBeNull();
    expect(screen.getByTestId('recording-uploading-r1')).toBeTruthy();
  });

  /** The retry belongs to its own row, and pressing it opens no detail screen. */
  it('leaves the other rows alone', async () => {
    mockLibrary.entries = [entry('r1', 'failed'), entry('r2', 'uploaded')];

    await render(<RecordingsLibraryScreen />);
    await fireEvent.press(screen.getByTestId('recording-retry-r1'));

    await waitFor(() => expect(mockUploadNow).toHaveBeenCalledWith('r1'));
    expect(screen.queryByTestId('recording-retry-r2')).toBeNull();
  });

  /** The mark the item asks for, which the screen already drew. */
  it('marks a local-only recording as being on this device', async () => {
    mockLibrary.entries = [entry('r1', 'localOnly')];

    await render(<RecordingsLibraryScreen />);

    expect(screen.getByTestId('recording-status-localOnly')).toBeTruthy();
  });
});

/**
 * The retry is drawn inside the row's own button, so on iOS a screen reader
 * never stops on it. The row offers it as an action and names itself.
 */
describe('a recordings row for a screen reader', () => {
  function row(id: string) {
    return screen.getByTestId(`recording-entry-${id}`);
  }

  it('offers upload now as an action that requeues through the library', async () => {
    mockLibrary.entries = [entry('r1', 'failed')];

    await render(<RecordingsLibraryScreen />);
    expect(row('r1').props.accessibilityActions).toEqual([
      { name: 'uploadNow', label: 'Upload now' },
    ]);
    await fireEvent(row('r1'), 'accessibilityAction', { nativeEvent: { actionName: 'uploadNow' } });

    expect(mockUploadNow).toHaveBeenCalledWith('r1');
    expect(mockUploadNow).toHaveBeenCalledTimes(1);
  });

  it('offers no upload while the upload is in flight', async () => {
    mockLibrary.entries = [entry('r1', 'failed')];
    mockLibrary.uploadingId = 'r1';

    await render(<RecordingsLibraryScreen />);

    expect(row('r1').props.accessibilityActions).toBeUndefined();
  });

  it('offers no upload once the recording is uploaded', async () => {
    mockLibrary.entries = [entry('r1', 'uploaded')];

    await render(<RecordingsLibraryScreen />);

    expect(row('r1').props.accessibilityActions).toBeUndefined();
  });

  it('names itself by recording, distance, duration and upload status', async () => {
    mockLibrary.entries = [entry('r1', 'failed')];

    await render(<RecordingsLibraryScreen />);
    const label: string = row('r1').props.accessibilityLabel;

    expect(label).toContain('Ride r1');
    expect(label).toContain('30');
    expect(label).toContain('1:00:00');
    expect(label).toContain('recording.library.status.failed');
  });
});
