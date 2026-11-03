/**
 * Scenario: an old link or notification points at the retired history range page.
 *
 * Expected behaviour: the link is routed to Settings carrying a request for the history sheet,
 * and Settings opens the sheet once for that request.
 */

import { renderHook } from '@testing-library/react-native';

import { openableSystemPath } from '@/features/insights/lib/pushPayload';
import { HISTORY_RANGE_PARAM, useOpenHistoryRangeFromLink } from '@/shared/app/historyRange';

let mockParams: Record<string, string> = {};
const mockSetParams = jest.fn();
const mockOpenSheet = jest.fn();

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: jest.fn() },
  useLocalSearchParams: () => mockParams,
  useRouter: () => ({ setParams: mockSetParams }),
}));
jest.mock('@/shared/app/sheetRequest', () => ({
  openSheet: (...args: unknown[]) => mockOpenSheet(...args),
}));

beforeEach(() => {
  mockParams = {};
  jest.clearAllMocks();
});

describe('the retired history range link', () => {
  it.each(['veloq:///sync-settings', 'veloq://sync-settings', '/sync-settings'])(
    'routes %s to Settings with the sheet requested',
    (link) => {
      expect(openableSystemPath(link, 'i1')).toBe(`/settings?${HISTORY_RANGE_PARAM}=1`);
    }
  );

  it('opens the sheet once when Settings carries the request, and clears it', () => {
    mockParams = { [HISTORY_RANGE_PARAM]: '1' };
    renderHook(() => useOpenHistoryRangeFromLink());

    expect(mockOpenSheet).toHaveBeenCalledTimes(1);
    expect(mockOpenSheet.mock.calls[0][0]).toBe('sheets/history-range');
    expect(mockSetParams).toHaveBeenCalledWith({ [HISTORY_RANGE_PARAM]: undefined });
  });

  it('opens nothing without the request', () => {
    renderHook(() => useOpenHistoryRangeFromLink());

    expect(mockOpenSheet).not.toHaveBeenCalled();
  });
});
