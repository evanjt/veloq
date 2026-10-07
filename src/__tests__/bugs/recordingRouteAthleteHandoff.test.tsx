import React from 'react';
import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { ScrollView, StyleSheet } from 'react-native';
import { TAB_BAR_SAFE_PADDING } from '@/shared/ui';

import RecordingScreen from '@/app/recording/[type]';
import RecordScreen from '@/app/record';
import ReviewScreen from '@/app/recording/review';
import { ManualEntryForm } from '@/features/recording/components/ManualEntryForm';
import {
  holdRecordingOnSignOut,
  resumeHeldRecordingForAthlete,
} from '@/features/recording/lib/holdRecordingOnSignOut';
import { saveRecordingBackup } from '@/features/recording/lib/storage/recordingBackup';
import { saveRecording } from '@/features/recording/lib/storage/recordingLibrary';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { useAuthStore } from '@/shared/app/AuthStore';
import { navigateTo, replaceTo } from '@/shared/app/navigation';

let mockParams: Record<string, string | undefined> = { type: 'Ride' };

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  Stack: { Screen: () => null },
  router: { replace: jest.fn(), back: jest.fn() },
  useLocalSearchParams: () => mockParams,
}));
jest.mock('@/shared/app', () => ({
  useTheme: () => ({ isDark: false }),
  useMetricSystem: () => true,
}));
jest.mock('@/shared/app/TopSafeAreaContext', () => ({
  useScreenSafeAreaEdges: () => ['top', 'bottom', 'left', 'right'],
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));
jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), replaceTo: jest.fn() }));
jest.mock('@/features/recording', () =>
  require('../__shared__/recordingBarrelStub').withRecordingOverrides({
    RecordingMap: jest.requireMock('@/features/recording/components/RecordingMap').RecordingMap,
    useRecordingPreferences: jest.requireActual(
      '@/features/recording/stores/RecordingPreferencesStore'
    ).useRecordingPreferences,
    WorkoutGuide: jest.requireActual('@/features/recording/components/WorkoutGuide').WorkoutGuide,
    RecordingGate: () => null,
    canStartAfterScopeWarning: () => true,
    useAlwaysLocationPrompt: () => undefined,
    useCanRecord: () => ({ canRecord: true, reason: 'ok' }),
    usePermissionUpgrade: () => ({
      upgradePermissions: jest.fn(),
      isUpgrading: false,
      error: null,
    }),
    promptInterruptedRecording: jest.fn(async () => undefined),
    sessionReturnRoute: jest.requireActual('@/features/recording/lib/sessionReturnRoute')
      .sessionReturnRoute,
    useUploadPermissionStore: (selector: (state: object) => unknown) =>
      selector({ recordingWithoutScope: false, continueWithoutScope: jest.fn() }),
  })
);
jest.mock('@/features/recording/lib/storage/recordingBackup', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingBackup'),
  saveRecordingBackup: jest.fn(async () => true),
}));
jest.mock('@/features/recording/lib/storage/recordingLibrary', () => ({
  ...jest.requireActual('@/features/recording/lib/storage/recordingLibrary'),
  saveRecording: jest.fn(async () => ({ id: 'rec-manual', kind: 'manual' })),
  attachEngineActivity: jest.fn(async () => null),
}));
jest.mock('@/features/recording/lib/storage/provisionalActivity', () => ({
  writeProvisionalActivity: jest.fn(async () => null),
}));
jest.mock('@/features/recording/lib/upload/intervalsUploads', () => ({
  uploadRecordingNow: jest.fn(async () => ({
    outcome: jest.requireMock('veloqrs').UploadOutcome.Uploaded,
  })),
}));
jest.mock('@/features/recording/components/RecordingMap', () => ({
  RecordingMap: ({ coordinates }: { coordinates: number[][] }) => {
    const { Text: MockText } = require('react-native');
    return <MockText testID="recording-map">{JSON.stringify(coordinates)}</MockText>;
  },
}));
jest.mock('@/features/recording/hooks/useLocationPermission', () => ({
  useLocationPermission: () => ({ hasPermission: true, requestPermission: jest.fn() }),
}));
jest.mock('@/features/recording/components/DataFieldGrid', () => ({
  DataFieldGrid: () => null,
}));
jest.mock('@/features/recording/components/ControlBar', () => ({
  ControlBar: ({ status }: { status: string }) => {
    const { Text: MockText } = require('react-native');
    return <MockText testID="recording-controls">{status}</MockText>;
  },
}));

beforeEach(() => {
  jest.clearAllMocks();
  mockParams = { type: 'Ride' };
  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true, authMethod: 'apiKey' });
});

afterEach(() => {
  useRecordingStore.getState().reset();
});

it('hides the outgoing ride while another athlete waits for its backup handoff', async () => {
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().addGpsPoint({
    latitude: 47,
    longitude: 8,
    altitude: 400,
    accuracy: 5,
    speed: 1,
    heading: 0,
    timestamp: useRecordingStore.getState().startTime!,
  });
  await holdRecordingOnSignOut('athlete-a');

  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
  const pending = resumeHeldRecordingForAthlete('athlete-b');
  expect(useRecordingStore.getState().status).toBe('stopped');

  render(<RecordingScreen />);
  expect(screen.queryByTestId('recording-map')).toBeNull();
  expect(screen.queryByTestId('recording-controls')).toBeNull();
  expect(screen.queryByTestId('unlock-track-handle')).toBeNull();
  expect(useRecordingStore.getState().athleteId).toBe('athlete-a');

  await act(async () => {
    finishWrite(false);
    await pending;
  });
  expect(useRecordingStore.getState().athleteId).toBe('athlete-b');
  expect(screen.getByTestId('recording-map')).toHaveTextContent('[]');
  expect(screen.getByTestId('unlock-track-handle')).toBeTruthy();
});

it('shows a stopped ride to the athlete who recorded it', () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().addGpsPoint({
    latitude: 47,
    longitude: 8,
    altitude: 400,
    accuracy: 5,
    speed: 1,
    heading: 0,
    timestamp: useRecordingStore.getState().startTime!,
  });
  useRecordingStore.getState().stopRecording();

  render(<RecordingScreen />);
  expect(screen.getByTestId('recording-map')).toHaveTextContent('[[47,8]]');
  expect(screen.getByTestId('unlock-track-handle')).toBeTruthy();
});

it('keeps the new athlete on the picker while the outgoing ride is handed off', async () => {
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  await holdRecordingOnSignOut('athlete-a');

  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
  const pending = resumeHeldRecordingForAthlete('athlete-b');

  render(<RecordScreen />);
  expect(replaceTo).not.toHaveBeenCalledWith('/recording/review');

  await act(async () => {
    finishWrite(false);
    await pending;
  });
  expect(useRecordingStore.getState().status).toBe('idle');
  expect(screen.getByTestId('record-type-Ride')).toBeTruthy();
  expect(replaceTo).not.toHaveBeenCalledWith('/recording/review');
});

it('leaves review for the picker when another athlete owns the held ride', async () => {
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  await holdRecordingOnSignOut('athlete-a');

  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
  const pending = resumeHeldRecordingForAthlete('athlete-b');

  render(<ReviewScreen />);
  expect(screen.queryByTestId('review-save-button')).toBeNull();

  await act(async () => {
    finishWrite(false);
    await pending;
  });
  expect(screen.queryByTestId('review-save-button')).toBeNull();
  expect(replaceTo).toHaveBeenCalledWith('/record');
});

it('still opens review for the athlete who owns the stopped ride', () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();

  const picker = render(<RecordScreen />);
  expect(replaceTo).toHaveBeenCalledWith('/recording/review');
  picker.unmount();

  render(<ReviewScreen />);
  expect(screen.getByTestId('review-save-button')).toBeTruthy();
});

it('saves a manual entry made during the handoff for the new athlete', async () => {
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  const outgoingStart = useRecordingStore.getState().startTime;
  await holdRecordingOnSignOut('athlete-a');

  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
  const pending = resumeHeldRecordingForAthlete('athlete-b');

  const form = render(<ManualEntryForm activityType="Yoga" bottomPadding={0} />);
  fireEvent.changeText(form.getByTestId('manual-entry-duration'), '30');
  fireEvent.press(form.getByTestId('manual-entry-continue'));
  fireEvent.press(form.getByTestId('manual-entry-continue'));
  expect(navigateTo).not.toHaveBeenCalled();
  expect(useRecordingStore.getState().athleteId).toBe('athlete-a');
  expect(useRecordingStore.getState().status).toBe('stopped');

  await act(async () => {
    finishWrite(false);
    await pending;
  });
  expect(useRecordingStore.getState()).toMatchObject({
    athleteId: 'athlete-b',
    status: 'recording',
    mode: 'manual',
    activityType: 'Yoga',
  });
  expect(navigateTo).toHaveBeenCalledTimes(1);
  const { params } = (navigateTo as jest.Mock).mock.calls[0][0];
  expect(params).toMatchObject({ manual: 'true', durationSeconds: '1800' });
  form.unmount();

  mockParams = params;
  render(<ReviewScreen />);
  expect(replaceTo).not.toHaveBeenCalledWith('/record');
  await act(async () => {
    fireEvent.press(screen.getByTestId('review-save-button'));
  });
  expect(saveRecording).toHaveBeenCalledTimes(1);
  expect(saveRecording).toHaveBeenCalledWith(
    expect.objectContaining({
      activityType: 'Yoga',
      durationSeconds: 1800,
      manualBody: expect.objectContaining({ type: 'Yoga', elapsed_time: 1800 }),
    })
  );

  useRecordingStore.getState().reset();
  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  await expect(resumeHeldRecordingForAthlete('athlete-a')).resolves.toBe('/recording/review');
  expect(useRecordingStore.getState()).toMatchObject({
    athleteId: 'athlete-a',
    status: 'stopped',
    mode: 'gps',
    startTime: outgoingStart,
  });
});

it('drops a held manual entry when its athlete signs out before the handoff clears', async () => {
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  await holdRecordingOnSignOut('athlete-a');

  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
  const pending = resumeHeldRecordingForAthlete('athlete-b');

  render(<ManualEntryForm activityType="Yoga" bottomPadding={0} />);
  fireEvent.changeText(screen.getByTestId('manual-entry-duration'), '30');
  fireEvent.press(screen.getByTestId('manual-entry-continue'));
  useAuthStore.setState({ athleteId: null, isAuthenticated: false });

  await act(async () => {
    finishWrite(false);
    await pending;
  });
  expect(useRecordingStore.getState().status).toBe('idle');
  expect(navigateTo).not.toHaveBeenCalled();
});

it('drops a held manual entry when its form closes before the handoff clears', async () => {
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  await holdRecordingOnSignOut('athlete-a');

  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
  const pending = resumeHeldRecordingForAthlete('athlete-b');

  const form = render(<ManualEntryForm activityType="Yoga" bottomPadding={0} />);
  fireEvent.changeText(form.getByTestId('manual-entry-duration'), '30');
  fireEvent.press(form.getByTestId('manual-entry-continue'));
  form.unmount();

  await act(async () => {
    finishWrite(false);
    await pending;
  });
  expect(useRecordingStore.getState().status).toBe('idle');
  expect(navigateTo).not.toHaveBeenCalled();
});

it('sends the athlete to their own held ride when the handoff restores it', async () => {
  useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Run', 'gps');
  useRecordingStore.getState().stopRecording();
  const ownStart = useRecordingStore.getState().startTime;
  await holdRecordingOnSignOut('athlete-b');

  useAuthStore.setState({ athleteId: 'athlete-a', isAuthenticated: true });
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  await resumeHeldRecordingForAthlete('athlete-a');
  (saveRecordingBackup as jest.Mock).mockResolvedValueOnce(false);
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();
  await holdRecordingOnSignOut('athlete-a');

  let finishWrite!: (saved: boolean) => void;
  (saveRecordingBackup as jest.Mock).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finishWrite = resolve;
      })
  );
  useAuthStore.setState({ athleteId: 'athlete-b', isAuthenticated: true });
  const pending = resumeHeldRecordingForAthlete('athlete-b');

  render(<ManualEntryForm activityType="Yoga" bottomPadding={0} />);
  fireEvent.changeText(screen.getByTestId('manual-entry-duration'), '30');
  fireEvent.press(screen.getByTestId('manual-entry-continue'));

  await act(async () => {
    finishWrite(false);
    await pending;
  });
  expect(useRecordingStore.getState()).toMatchObject({
    athleteId: 'athlete-b',
    status: 'stopped',
    mode: 'gps',
    activityType: 'Run',
    startTime: ownStart,
  });
  expect(navigateTo).toHaveBeenCalledTimes(1);
  expect(navigateTo).toHaveBeenCalledWith('/recording/review');
});

it('pads the review scroll content past the tab bar so save, trim and discard can be reached', () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().stopRecording();

  const { UNSAFE_getAllByType } = render(<ReviewScreen />);
  const scroll = UNSAFE_getAllByType(ScrollView).find(
    (view) => view.props.contentContainerStyle !== undefined
  )!;
  const { paddingBottom } = StyleSheet.flatten(scroll.props.contentContainerStyle);

  expect(paddingBottom).toBeGreaterThanOrEqual(TAB_BAR_SAFE_PADDING);
});
