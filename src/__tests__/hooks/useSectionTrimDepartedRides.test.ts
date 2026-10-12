import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionTrim } from '@/features/routes/hooks/useSectionTrim';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';

const mockInvalidateQueries = jest.fn();

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${options.name} ${options.date}` : key,
  }),
}));
jest.mock('@tanstack/react-query', () => ({
  ...jest.requireActual('@tanstack/react-query'),
  useQueryClient: () => ({ invalidateQueries: mockInvalidateQueries }),
}));

const polyline = Array.from({ length: 20 }, (_, i) => ({ lat: 46 + i * 0.0001, lng: 7 }));
const section = { id: 'sec1', polyline, distanceMeters: 200 } as unknown as FrequentSection;
const ride = { activityId: 'a1', name: 'Morning ride', date: 1_710_200_000 };

async function trimWith(departed: Promise<unknown[] | null>) {
  const engine = { runSectionBoundsEdit: jest.fn(() => departed) };
  (getEngine as jest.Mock).mockReturnValue(engine);
  const onRefresh = jest.fn();
  const hook = await renderHook(() => useSectionTrim(section, onRefresh, true));
  await act(() => hook.result.current.startTrim());
  await act(() => hook.result.current.setTrimStart(2));
  await act(() => hook.result.current.setTrimEnd(15));
  return { hook, engine, onRefresh };
}

describe('useSectionTrim departed rides', () => {
  beforeEach(() => {
    mockInvalidateQueries.mockClear();
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });
  afterEach(() => jest.restoreAllMocks());

  it('names the ride the trim took out of the section', async () => {
    const { hook, engine, onRefresh } = await trimWith(Promise.resolve([ride]));

    await act(() => hook.result.current.confirmTrim());

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({
      kind: 'trim',
      sectionId: 'sec1',
      startIndex: 2,
      endIndex: 15,
    });
    expect(onRefresh).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('Morning ride');
  });

  it('shows nothing when the trim took no ride out', async () => {
    const { hook, onRefresh } = await trimWith(Promise.resolve([]));

    await act(() => hook.result.current.confirmTrim());

    expect(onRefresh).toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows the failure and no ride when the trim failed', async () => {
    const { hook, onRefresh } = await trimWith(Promise.resolve(null));

    await act(() => hook.result.current.confirmTrim());

    expect(onRefresh).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).not.toContain('Morning ride');
  });

  it('returns to the caller while the edit is still running', async () => {
    const { hook, engine, onRefresh } = await trimWith(new Promise(() => {}));
    let returned = false;

    await act(() => {
      void hook.result.current.confirmTrim();
      returned = true;
    });

    expect(returned).toBe(true);
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(1);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('names the ride a reset took out once the reset is confirmed', async () => {
    const { hook, engine, onRefresh } = await trimWith(Promise.resolve([ride]));
    await act(() => hook.result.current.resetBounds());
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { onPress?: () => unknown }[];
    (Alert.alert as jest.Mock).mockClear();

    await act(async () => {
      await buttons[1].onPress?.();
    });

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({ kind: 'reset', sectionId: 'sec1' });
    expect(onRefresh).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('Morning ride');
  });

  it('holds the sheet busy during reset and reports a failed edit', async () => {
    let settle!: (value: unknown[] | null) => void;
    const pending = new Promise<unknown[] | null>((resolve) => {
      settle = resolve;
    });
    const { hook, engine, onRefresh } = await trimWith(pending);
    await act(() => hook.result.current.resetBounds());
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { onPress?: () => unknown }[];
    (Alert.alert as jest.Mock).mockClear();

    await act(() => {
      void buttons[1].onPress?.();
      void hook.result.current.confirmTrim();
    });

    expect(hook.result.current.isSaving).toBe(true);
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(1);
    expect(engine.runSectionBoundsEdit).toHaveBeenCalledWith({ kind: 'reset', sectionId: 'sec1' });

    await act(async () => settle(null));

    expect(hook.result.current.isSaving).toBe(false);
    expect(hook.result.current.isTrimming).toBe(true);
    expect(onRefresh).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][0]).toBe('sections.trimFailedTitle');
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('sections.trimFailed');
  });

  it('refuses reset while a trim is pending', async () => {
    const { hook, engine } = await trimWith(new Promise(() => {}));
    await act(() => {
      void hook.result.current.confirmTrim();
      hook.result.current.resetBounds();
    });

    expect(engine.runSectionBoundsEdit).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('invalidates and announces a completed edit after unmount without refreshing', async () => {
    let settle!: (value: unknown[] | null) => void;
    const pending = new Promise<unknown[] | null>((resolve) => {
      settle = resolve;
    });
    const { hook, onRefresh } = await trimWith(pending);
    await act(() => hook.result.current.resetBounds());
    const buttons = (Alert.alert as jest.Mock).mock.calls[0][2] as { onPress?: () => unknown }[];
    (Alert.alert as jest.Mock).mockClear();
    await act(() => {
      void buttons[1].onPress?.();
    });
    await hook.unmount();

    await act(async () => settle([ride]));

    expect(mockInvalidateQueries).toHaveBeenCalledWith({ queryKey: ['sections'] });
    expect(onRefresh).not.toHaveBeenCalled();
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('Morning ride');
  });
});
