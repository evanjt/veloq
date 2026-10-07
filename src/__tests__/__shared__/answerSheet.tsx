import { act, renderHook } from '@testing-library/react-native';

import { useSheetRequest } from '@/shared/app/sheetRequest';

/**
 * Answers the sheet request a caller just pushed with `value`, or dismisses it
 * unanswered when `value` is null, as the sheet route does. The calling test mocks
 * `expo-router` with `router.push` recorded in `push` and `useLocalSearchParams`
 * read from `params`.
 */
export function answerSheet<R>(
  push: jest.Mock,
  params: { request?: string },
  value: R | null
): void {
  params.request = push.mock.calls.at(-1)[0].params.request;
  const sheet = renderHook(() => useSheetRequest<unknown, R>());
  act(() => {
    if (value !== null) sheet.result.current.resolve(value);
  });
  sheet.unmount();
}
