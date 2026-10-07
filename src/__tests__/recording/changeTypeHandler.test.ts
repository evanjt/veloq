import { renderHook, act } from '@testing-library/react-native';

import { useRecordingHandlers } from '@/features/recording/hooks/useRecordingHandlers';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';

jest.mock('@/shared/native/engine', () => ({ getEngine: () => null }));

it('changes the live session type when a new type is chosen', () => {
  useRecordingStore.getState().reset();
  useRecordingStore.getState().startRecording('Ride', 'gps');
  const { result } = renderHook(() => useRecordingHandlers());
  act(() => result.current.handleChangeType('Run'));
  expect(useRecordingStore.getState().activityType).toBe('Run');
});
