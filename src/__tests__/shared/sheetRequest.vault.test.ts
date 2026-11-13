import { renderHook, act } from '@testing-library/react-native';
import { openSheet, useSheetRequest, useSheetOpener } from '@/shared/app/sheetRequest';

const mockPush = jest.fn();
const mockBack = jest.fn();
const mockReplace = jest.fn();
let mockCanGoBack = true;
let mockParams: { request?: string } = {};

jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: {
    push: (...a: unknown[]) => mockPush(...a),
    back: () => mockBack(),
    replace: (...a: unknown[]) => mockReplace(...a),
    canGoBack: () => mockCanGoBack,
  },
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
  mockReplace.mockClear();
  mockCanGoBack = true;
  mockParams = {};
});

describe('sheet request channel', () => {
  it('hands the caller the value the sheet selects and the sheet its object input', async () => {
    const result = openSheet<{ name: string }, string>('/sheet', { name: 'ride' });
    expect(mockPush.mock.calls[0][0].pathname).toBe('/sheet');
    const sheet = await mountSheet(pushedId());
    expect(sheet.result.current.input).toEqual({ name: 'ride' });
    await act(() => sheet.result.current.resolve('picked'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'picked' });
  });

  it('resolves cancelled when the sheet unmounts without a selection', async () => {
    const result = openSheet('/sheet', { name: 'x' });
    const sheet = await mountSheet(pushedId());
    await sheet.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('ignores a second resolve and keeps the first value after unmount', async () => {
    const result = openSheet<{ name: string }, string>('/sheet', { name: 'x' });
    const sheet = await mountSheet(pushedId());
    await act(() => sheet.result.current.resolve('first'));
    await act(() => sheet.result.current.resolve('second'));
    await sheet.unmount();
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'first' });
  });

  it('cancels an open request when the caller unmounts', async () => {
    const caller = await renderHook(() => useSheetOpener());
    const result = caller.result.current<{ name: string }, string>('/sheet', { name: 'x' });
    await caller.unmount();
    await expect(result).resolves.toEqual({ kind: 'cancelled' });
  });

  it('reads an unknown id as cancelled and closes the sheet', async () => {
    const sheet = await mountSheet('gone');
    expect(sheet.result.current.input).toBeUndefined();
    expect(sheet.result.current.missing).toBe(true);
    expect(mockBack).toHaveBeenCalledTimes(1);
    expect(mockReplace).not.toHaveBeenCalled();
  });

  it('leaves an unknown request for the Feed when nothing is behind the sheet', async () => {
    mockCanGoBack = false;
    const sheet = await mountSheet('gone');
    expect(sheet.result.current.missing).toBe(true);
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('leaves for the Feed after a selection when nothing is behind the sheet', async () => {
    const result = openSheet<{ name: string }, string>('/sheet', { name: 'x' });
    const sheet = await mountSheet(pushedId());
    mockCanGoBack = false;
    await act(() => sheet.result.current.resolve('picked'));
    await expect(result).resolves.toEqual({ kind: 'selected', value: 'picked' });
    expect(mockBack).not.toHaveBeenCalled();
    expect(mockReplace).toHaveBeenCalledWith('/');
  });

  it('keeps two callers of the same route apart', async () => {
    const first = openSheet<{ name: string }, string>('/sheet', { name: 'a' });
    const firstId = pushedId();
    const second = openSheet<{ name: string }, string>('/sheet', { name: 'b' });
    const secondId = pushedId();
    expect(firstId).not.toBe(secondId);
    await (await mountSheet(firstId)).unmount();
    const sheet = await mountSheet(secondId);
    expect(sheet.result.current.input).toEqual({ name: 'b' });
    await act(() => sheet.result.current.resolve('mine'));
    await expect(first).resolves.toEqual({ kind: 'cancelled' });
    await expect(second).resolves.toEqual({ kind: 'selected', value: 'mine' });
  });
});
