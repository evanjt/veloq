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

it('waits for a late opening transition end before running the read', () => {
  const read = jest.fn();
  renderHook(() => useAfterNavigationTransition(read));

  act(() => {
    listeners.get('transitionStart')?.({ data: { closing: false } });
    jest.advanceTimersByTime(2000);
  });
  expect(read).not.toHaveBeenCalled();

  act(() => listeners.get('transitionEnd')?.({ data: { closing: false } }));
  expect(read).toHaveBeenCalledTimes(1);
});

it('runs for an already settled screen when no transition arrives', () => {
  const read = jest.fn();
  renderHook(() => useAfterNavigationTransition(read));

  act(() => jest.runOnlyPendingTimers());
  expect(read).toHaveBeenCalledTimes(1);
});

it('does not run after unmount or on a closing transition', () => {
  const read = jest.fn();
  const view = renderHook(() => useAfterNavigationTransition(read));
  act(() => listeners.get('transitionEnd')?.({ data: { closing: true } }));
  expect(read).not.toHaveBeenCalled();

  view.unmount();
  act(() => jest.runOnlyPendingTimers());
  expect(read).not.toHaveBeenCalled();
});
