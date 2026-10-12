import { act, renderHook } from '@testing-library/react-native';
import { useAfterNavigationTransition } from '@/shared/async/useAfterNavigationTransition';

type TransitionEvent = { data: { closing: boolean } };
const listeners = new Map<string, (event: TransitionEvent) => void>();
const mockAddListener = jest.fn((event: string, listener: (event: TransitionEvent) => void) => {
  listeners.set(event, listener);
  return () => listeners.delete(event);
});

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  useNavigation: () => ({ addListener: mockAddListener }),
}));

beforeEach(() => {
  jest.useFakeTimers();
  listeners.clear();
  mockAddListener.mockClear();
});

afterEach(() => jest.useRealTimers());

it('waits for a late opening transition end before running the read', async () => {
  const read = jest.fn();
  await renderHook(() => useAfterNavigationTransition(read));

  await act(() => {
    listeners.get('transitionStart')?.({ data: { closing: false } });
    jest.advanceTimersByTime(2000);
  });
  expect(read).not.toHaveBeenCalled();

  await act(() => listeners.get('transitionEnd')?.({ data: { closing: false } }));
  expect(read).toHaveBeenCalledTimes(1);
});

it('runs for an already settled screen when no transition arrives', async () => {
  const read = jest.fn();
  await renderHook(() => useAfterNavigationTransition(read));

  await act(() => jest.runOnlyPendingTimers());
  expect(read).toHaveBeenCalledTimes(1);
});

it('does not run after unmount or on a closing transition', async () => {
  const read = jest.fn();
  const view = await renderHook(() => useAfterNavigationTransition(read));
  await act(() => listeners.get('transitionEnd')?.({ data: { closing: true } }));
  expect(read).not.toHaveBeenCalled();

  await view.unmount();
  await act(() => jest.runOnlyPendingTimers());
  expect(read).not.toHaveBeenCalled();
});
