import React from 'react';
import { Alert } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as Sharing from 'expo-sharing';

import RecordingDetailScreen from '@/app/recordings/[id]';
import {
  getVisibleRecording,
  recordingFitExists,
} from '@/features/recording/lib/storage/recordingLibrary';
import type { RecordingLibraryEntry } from '@/types';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: string | Record<string, unknown>) =>
      typeof options === 'string' ? options : options ? `${key}:${JSON.stringify(options)}` : key,
  }),
}));
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useLocalSearchParams: () => ({ id: 'r1' }),
  router: { back: jest.fn() },
}));
jest.mock('expo-sharing', () => ({
  ...jest.requireActual('expo-sharing'),
  isAvailableAsync: jest.fn(async () => true),
  shareAsync: jest.fn(),
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/ui', () => ({ ScreenSafeAreaView: require('react-native').View }));
jest.mock('@/features/recording/components/RecordingMap', () => ({ RecordingMap: () => null }));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    readRecordingTrack: jest.fn(async () => []),
  })
);
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  getVisibleRecording: jest.fn(),
  recordingFitExists: jest.fn(),
}));
jest.mock('@/features/recording/hooks/useRecordingLibrary', () => ({
  useRecordingLibrary: () => ({ uploadNow: jest.fn(), remove: jest.fn(), uploadingId: null }),
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
  (getVisibleRecording as jest.Mock).mockResolvedValue(ENTRY);
  (recordingFitExists as jest.Mock).mockResolvedValue(true);
});

it.each(['pending', 'uploaded'] as const)('shares a retained %s FIT', async (uploadStatus) => {
  (getVisibleRecording as jest.Mock).mockResolvedValue({ ...ENTRY, uploadStatus });
  render(<RecordingDetailScreen />);
  fireEvent.press(await screen.findByText('Share FIT file'));
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
  render(<RecordingDetailScreen />);
  await screen.findByText('Status');
  expect(screen.queryByText('Share FIT file')).toBeNull();
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('does not hand a removed FIT to the share sheet', async () => {
  render(<RecordingDetailScreen />);
  const share = await screen.findByText('Share FIT file');
  (recordingFitExists as jest.Mock).mockResolvedValue(false);
  fireEvent.press(share);
  await waitFor(() => expect(recordingFitExists).toHaveBeenCalledTimes(2));
  expect(Sharing.shareAsync).not.toHaveBeenCalled();
});

it('names the selected recording before offering deletion', async () => {
  const alert = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  render(<RecordingDetailScreen />);
  fireEvent.press(await screen.findByText('Delete'));

  const body = alert.mock.calls[0][1] as string;
  expect(body).toContain('Ride');
  expect(body).toContain(new Date(ENTRY.startTime).toLocaleString());
  expect(alert.mock.calls[0][2]?.map((button) => button.style)).toContain('cancel');
});

it("offers nothing on another athlete's ride, which reads as not found", async () => {
  (getVisibleRecording as jest.Mock).mockResolvedValue(null);
  render(<RecordingDetailScreen />);

  await screen.findByText('Recording not found');
  expect(screen.queryByText('Share FIT file')).toBeNull();
  expect(screen.queryByText('Delete')).toBeNull();
  expect(screen.queryByText('Upload now')).toBeNull();
});
