import { renderHook, act } from '@testing-library/react-native';
import { openSheet, useSheetRequest, useSheetOpener } from '@/shared/app/sheetRequest';

const mockPush = jest.fn();
const mockBack = jest.fn();
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { push: (...a: unknown[]) => mockPush(...a), back: () => mockBack() },
  useLocalSearchParams: () => mockParams,
}));

const pushedId = (call = mockPush.mock.calls.length - 1): string =>
  mockPush.mock.calls[call][0].params.request;

function mountSheet(id: string) {
  mockParams = { request: id };
  return renderHook(() => useSheetRequest<{ name: string }, string>());
}

beforeEach(() => {
  mockPush.mockClear();
  mockBack.mockClear();
  mockParams = {};
});

describe('sheet request channel', () => {
  it('hands the caller the value the sheet selects and the sheet its object input', async () => {
    const result = openSheet<{ name: string }, string>('/sheet', { name: 'ride' });
    expect(mockPush.mock.calls[0][0].pathname).toBe('/sheet');
    const sheet = mountSheet(pushedId());
    expect(sheet.result.current.input).toEqual({ name: 'ride' });
    act(() => sheet.result.current.resolve('picked'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'picked' });
  });

  it('resolves cancelled when the sheet unmounts without a selection', async () => {
    const result = openSheet('/sheet', { name: 'x' });
    const sheet = mountSheet(pushedId());
    sheet.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('ignores a second resolve and keeps the first value after unmount', async () => {
    const result = openSheet<{ name: string }, string>('/sheet', { name: 'x' });
    const sheet = mountSheet(pushedId());
    act(() => sheet.result.current.resolve('first'));
    act(() => sheet.result.current.resolve('second'));
    sheet.unmount();
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'first' });
  });

  it('cancels an open request when the caller unmounts', async () => {
    const caller = renderHook(() => useSheetOpener());
    const result = caller.result.current<{ name: string }, string>('/sheet', { name: 'x' });
    caller.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('reads an unknown id as cancelled and closes the sheet', () => {
    const sheet = mountSheet('gone');
    expect(sheet.result.current.input).toBeUndefined();
    expect(sheet.result.current.missing).toBe(true);
    expect(mockBack).toHaveBeenCalledTimes(1);
  });

  it('keeps two callers of the same route apart', async () => {
    const first = openSheet<{ name: string }, string>('/sheet', { name: 'a' });
    const firstId = pushedId();
    const second = openSheet<{ name: string }, string>('/sheet', { name: 'b' });
    const secondId = pushedId();
    expect(firstId).not.toBe(secondId);
    mountSheet(firstId).unmount();
    const sheet = mountSheet(secondId);
    expect(sheet.result.current.input).toEqual({ name: 'b' });
    act(() => sheet.result.current.resolve('mine'));
    await expect(first).resolves.toEqual({ kind: 'cancelled' });
    await expect(second).resolves.toEqual({ kind: 'selected', value: 'mine' });
  });
});
