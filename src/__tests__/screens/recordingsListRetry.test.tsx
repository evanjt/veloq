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
    TAB_BAR_SAFE_PADDING: 0,
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
    (status) => {
      mockLibrary.entries = [entry('r1', status)];

      render(<RecordingsLibraryScreen />);

      expect(screen.getByTestId('recording-retry-r1')).toBeTruthy();
    }
  );

  it('offers no retry once the recording is uploaded', () => {
    mockLibrary.entries = [entry('r1', 'uploaded')];

    render(<RecordingsLibraryScreen />);

    expect(screen.queryByTestId('recording-retry-r1')).toBeNull();
  });

  it('requeues through the library upload path when the retry is pressed', async () => {
    mockLibrary.entries = [entry('r1', 'failed')];

    render(<RecordingsLibraryScreen />);
    fireEvent.press(screen.getByTestId('recording-retry-r1'));

    await waitFor(() => expect(mockUploadNow).toHaveBeenCalledWith('r1'));
    expect(mockUploadNow).toHaveBeenCalledTimes(1);
  });

  /** An upload in flight is not a second press: the row says so instead. */
  it('shows the upload running rather than a retry while it is in flight', () => {
    mockLibrary.entries = [entry('r1', 'failed')];
    mockLibrary.uploadingId = 'r1';

    render(<RecordingsLibraryScreen />);

    expect(screen.queryByTestId('recording-retry-r1')).toBeNull();
    expect(screen.getByTestId('recording-uploading-r1')).toBeTruthy();
  });

  /** The retry belongs to its own row, and pressing it opens no detail screen. */
  it('leaves the other rows alone', async () => {
    mockLibrary.entries = [entry('r1', 'failed'), entry('r2', 'uploaded')];

    render(<RecordingsLibraryScreen />);
    fireEvent.press(screen.getByTestId('recording-retry-r1'));

    await waitFor(() => expect(mockUploadNow).toHaveBeenCalledWith('r1'));
    expect(screen.queryByTestId('recording-retry-r2')).toBeNull();
  });

  /** The mark the item asks for, which the screen already drew. */
  it('marks a local-only recording as being on this device', () => {
    mockLibrary.entries = [entry('r1', 'localOnly')];

    render(<RecordingsLibraryScreen />);

    expect(screen.getByTestId('recording-status-localOnly')).toBeTruthy();
  });
});
