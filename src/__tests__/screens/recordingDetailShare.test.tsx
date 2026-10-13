import React from 'react';
import { Alert } from 'react-native';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';

import RecordingDetailScreen from '@/app/recordings/[id]';
import {
  getVisibleRecording,
  recordingFitExists,
} from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingLibraryEntry } from '@/types';
import { formatDateTime } from '@/shared/format/format';
import { useRecordingLibrary } from '@/features/recording/hooks/useRecordingLibrary';
import { goBack } from '@/shared/app/navigation';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) => {
      const recording = require('../../i18n/locales/en-GB.json').recording;
      if (key === 'recording.duration') return recording.duration;
      if (key === 'recording.distance') return recording.distance;
      if (key === 'recording.fields.movingTime') return recording.fields.movingTime;
      if (key === 'recording.fields.avgSpeed') return recording.fields.avgSpeed;
      if (key === 'recording.fields.avgPace') return recording.fields.avgPace;
      if (key === 'recording.fields.distance') return recording.fields.distance;
      return typeof options === 'string'
        ? options
        : options
          ? `${key}:${JSON.stringify(options)}`
          : key;
    },
  }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'r1' }),
  router: { back: jest.fn() },
}));
jest.mock('@/shared/app/navigation', () => ({ goBack: jest.fn() }));
jest.mock('expo-sharing', () => ({
  ...jest.requireActual('expo-sharing'),
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => false,
}));
jest.mock('@/shared/ui', () => ({
  ScreenSafeAreaView: require('react-native').View,
  useHeroMapHeight: () => 300,
  useScrollEndInset: () => 0,
  EmptyState: ({ title }: { title: string }) => {
    const { Text } = require('react-native');
    return <Text>{title}</Text>;
  },
  ErrorState: () => null,
}));
const mockOpenEngine = { id: 'open-handle' };
jest.mock('@/shared/native/useEngineReady', () => ({
  useEngineReady: () => mockOpenEngine,
  useEngineOpening: () => false,
}));
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: () => null,
}));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides()
);
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  getVisibleRecording: jest.fn(),
  recordingFitExists: jest.fn(),
}));
jest.mock('@/features/recording/hooks/useRecordingLibrary', () => ({
  ...jest.requireActual('@/features/recording/hooks/useRecordingLibrary'),
  useRecordingLibrary: jest.fn(),
}));

const ENTRY: RecordingLibraryEntry = {
  id: 'r1',
  kind: 'fit',
  fitPath: '/recordings/r1.fit',
  name: 'Morning ride',
  activityType: 'Ride',
  startTime: 0,
  createdAt: 0,
  durationSeconds: 60,
  distanceMeters: 100,
  uploadStatus: 'pending',
  retryCount: 0,
};

beforeEach(() => {
  jest.clearAllMocks();
  (useRecordingLibrary as jest.Mock).mockReturnValue({
    uploadNow: jest.fn(),
    remove: jest.fn(),
    uploadingId: null,
  });
  (getVisibleRecording as jest.Mock).mockResolvedValue(ENTRY);
  (recordingFitExists as jest.Mock).mockResolvedValue(true);
  (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

it('keeps the named upload control busy while the recording uploads', async () => {
  const view = await render(<RecordingDetailScreen />);
  const upload = await screen.findByRole('button', { name: 'Upload now' });
  expect(upload).toBe(screen.getByTestId('recording-upload-button'));

  (useRecordingLibrary as jest.Mock).mockReturnValue({
    uploadNow: jest.fn(),
    remove: jest.fn(),
    uploadingId: ENTRY.id,
  });
  await view.rerender(<RecordingDetailScreen />);
  expect(screen.getByRole('button', { name: 'Upload now' }).props.accessibilityState.busy).toBe(
    true
  );
  expect(screen.getByTestId('recording-upload-button')).toBeTruthy();
});

it('labels saved recording stats without input units in imperial mode', async () => {
  (getVisibleRecording as jest.Mock).mockResolvedValue({
    ...ENTRY,
    durationSeconds: 1930,
    distanceMeters: 5149,
  });
  await render(<RecordingDetailScreen />);

  expect(await screen.findByText('32:10')).toBeTruthy();
  expect(screen.getByText('3.2 mi')).toBeTruthy();
  expect(screen.getByText('Moving Time')).toBeTruthy();
  expect(screen.getByText('Distance')).toBeTruthy();
  expect(screen.queryByText('Duration')).toBeNull();
  expect(screen.queryByText('Duration (minutes)')).toBeNull();
  expect(screen.queryByText('Distance (km)')).toBeNull();
});

it('shows the average speed of a saved ride and the average pace of a saved run', async () => {
  (getVisibleRecording as jest.Mock).mockResolvedValue({
    ...ENTRY,
    durationSeconds: 3600,
    distanceMeters: 32186.88,
  });
  const ride = await render(<RecordingDetailScreen />);
  expect(await screen.findByText('20.0 mph')).toBeTruthy();
  expect(screen.getByText('Avg Speed')).toBeTruthy();
  await ride.unmount();

  (getVisibleRecording as jest.Mock).mockResolvedValue({
    ...ENTRY,
    activityType: 'Run',
    durationSeconds: 3000,
    distanceMeters: 8046.72,
  });
  await render(<RecordingDetailScreen />);
  expect(await screen.findByText('10:00 /mi')).toBeTruthy();
  expect(screen.getByText('Avg Pace')).toBeTruthy();
  expect(screen.queryByText('Avg Speed')).toBeNull();
});

it.each(['pending', 'uploaded'] as const)('shares a retained %s FIT', async (uploadStatus) => {
  (getVisibleRecording as jest.Mock).mockResolvedValue({
    ...ENTRY,
    uploadStatus,
  });
  await render(<RecordingDetailScreen />);
  await fireEvent.press(await screen.findByText('Share FIT file'));
  await waitFor(() =>
    expect(Sharing.shareAsync).toHaveBeenCalledWith(ENTRY.fitPath, expect.any(Object))
  );
});

it.each([
  { kind: 'manual', fitPath: '' },
  { kind: 'fit', fitPath: '' },
  { kind: 'fit', fitPath: ENTRY.fitPath },
])('hides Share without an available FIT: %s', async (fields) => {
  (getVisibleRecording as jest.Mock).mockResolvedValue({ ...ENTRY, ...fields });
  (recordingFitExists as jest.Mock).mockResolvedValue(false);
  await render(<RecordingDetailScreen />);
  await screen.findByText('Status');
  expect(screen.queryByText('Share FIT file')).toBeNull();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('does not hand a removed FIT to the share sheet', async () => {
  await render(<RecordingDetailScreen />);
  const share = await screen.findByText('Share FIT file');
  (recordingFitExists as jest.Mock).mockResolvedValue(false);
  await fireEvent.press(share);
  await waitFor(() => expect(recordingFitExists).toHaveBeenCalledTimes(2));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('names the selected recording before offering deletion', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  await render(<RecordingDetailScreen />);
  await fireEvent.press(await screen.findByText('Delete'));

  const body = alert.mock.calls[0][1] as string;
  expect(body).toContain('Ride');
  expect(body).toContain(formatDateTime(ENTRY.startTime));
  expect(body).not.toMatch(/\d:\d\d:\d\d/);
  expect(alert.mock.calls[0][2]?.map((button) => button.style)).toContain('cancel');
});

it("offers nothing on another athlete's ride, which reads as not found", async () => {
  (getVisibleRecording as jest.Mock).mockResolvedValue(null);
  await render(<RecordingDetailScreen />);

  await screen.findByText('Recording not found');
  expect(screen.queryByText('Share FIT file')).toBeNull();
  expect(screen.queryByText('Delete')).toBeNull();
  expect(screen.queryByText('Upload now')).toBeNull();
});

describe('a share that does not open', () => {
  async function share() {
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<RecordingDetailScreen />);
    await fireEvent.press(await screen.findByText('Share FIT file'));
    await waitFor(() => expect(recordingFitExists).toHaveBeenCalledTimes(2));
    return alert;
  }

  it('says the share failed when the sheet throws', async () => {
    (Sharing.shareAsync as jest.Mock).mockRejectedValueOnce(new Error('no activity'));
    const alert = await share();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0][0]).toBe('export.shareFailedTitle');
    expect(alert.mock.calls[0][1]).toBe('export.shareFailed');
    expect(screen.getByText('Share FIT file')).toBeTruthy();
  });

  it('says the device cannot share, apart from a failure', async () => {
    (Sharing.isAvailableAsync as jest.Mock).mockResolvedValue(false);
    const alert = await share();
    await waitFor(() => expect(alert).toHaveBeenCalledTimes(1));
    expect(alert.mock.calls[0][0]).toBe('export.shareFailedTitle');
    expect(alert.mock.calls[0][1]).toBe('export.shareUnavailable');
    expect(Sharing.shareAsync).not.toHaveBeenCalled();
  });

  it('says nothing when the athlete closes the sheet', async () => {
    (Sharing.shareAsync as jest.Mock).mockResolvedValueOnce(undefined);
    const alert = await share();
    await waitFor(() => expect(Sharing.shareAsync).toHaveBeenCalled());
    expect(alert).not.toHaveBeenCalled();
  });
});

describe('a delete that does not land', () => {
  async function confirmDelete(remove: jest.Mock) {
    (useRecordingLibrary as jest.Mock).mockReturnValue({
      uploadNow: jest.fn(),
      remove,
      uploadingId: null,
    });
    const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
    await render(<RecordingDetailScreen />);
    await fireEvent.press(await screen.findByText('Delete'));
    const confirm = alert.mock.calls[0][2]?.find((button) => button.style === 'destructive');
    await act(async () => {
      await confirm?.onPress?.();
    });
    return alert;
  }

  it('says the recording was not deleted and stays on it', async () => {
    const remove = jest.fn().mockRejectedValue(new Error('EACCES'));
    const alert = await confirmDelete(remove);

    expect(remove).toHaveBeenCalledWith(ENTRY.id);
    expect(alert).toHaveBeenCalledTimes(2);
    expect(alert.mock.calls[1][0]).toBe('recording.library.deleteFailedTitle');
    expect(alert.mock.calls[1][1]).toBe('recording.library.deleteFailed');
    expect(goBack).not.toHaveBeenCalled();
  });

  it('leaves the screen once the recording is gone', async () => {
    const remove = jest.fn().mockResolvedValue(undefined);
    const alert = await confirmDelete(remove);

    expect(alert).toHaveBeenCalledTimes(1);
    expect(goBack).toHaveBeenCalledTimes(1);
  });
});
