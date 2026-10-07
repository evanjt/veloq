import { fireEvent, render } from '@testing-library/react-native';

import { ManualEntryForm } from '@/features/recording/components/ManualEntryForm';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { navigateTo } from '@/shared/app/navigation';

jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn() }));

beforeEach(() => {
  jest.clearAllMocks();
  useRecordingStore.getState().reset();
});

it('keeps a stopped ride and sends the athlete back to review', () => {
  useRecordingStore.getState().startRecording('Ride', 'gps');
  useRecordingStore.getState().addLap();
  useRecordingStore.getState().stopRecording();
  const before = useRecordingStore.getState();
  const view = render(<ManualEntryForm activityType="Yoga" bottomPadding={0} />);
  fireEvent.changeText(view.getByTestId('manual-entry-duration'), '30');
  fireEvent.press(view.getByTestId('manual-entry-continue'));

  expect(useRecordingStore.getState().activityType).toBe('Ride');
  expect(useRecordingStore.getState().status).toBe('stopped');
  expect(useRecordingStore.getState().streams).toBe(before.streams);
  expect(useRecordingStore.getState().laps).toBe(before.laps);
  expect(navigateTo).toHaveBeenCalledWith('/recording/review');
});
