import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useMergeSections } from '@/features/routes/hooks/useMergeSections';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));
jest.mock('react-i18next', () => ({
  ...jest.requireActual('react-i18next'),
  useTranslation: () => ({
    t: (key: string, options?: Record<string, string>) =>
      options ? `${key} ${options.name} ${options.date}` : key,
  }),
}));

const ride = { activityId: 'a1', name: 'Morning ride', date: 1_710_200_000 };

describe('useMergeSections departed rides', () => {
  beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('returns the kept section and names the ride that left in the merge', async () => {
    (getEngine as jest.Mock).mockReturnValue({
      runSectionMerge: jest.fn(async () => ({ sectionId: 'primary', departed: [ride] })),
    });
    const { result } = renderHook(() => useMergeSections());

    let kept: string | null = null;
    await act(async () => {
      kept = await result.current.merge('primary', 'donor');
    });

    expect(kept).toBe('primary');
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('Morning ride');
  });

  it('names no ride when none left, and shows the failure when the merge failed', async () => {
    const runSectionMerge = jest
      .fn()
      .mockResolvedValueOnce({ sectionId: 'primary', departed: [] })
      .mockResolvedValueOnce(null);
    (getEngine as jest.Mock).mockReturnValue({ runSectionMerge });
    const { result } = renderHook(() => useMergeSections());

    await act(async () => {
      expect(await result.current.merge('primary', 'donor')).toBe('primary');
    });
    expect(Alert.alert).not.toHaveBeenCalled();

    await act(async () => {
      expect(await result.current.merge('primary', 'donor')).toBeNull();
    });
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toBe('sections.mergeFailed');
    expect(result.current.isMerging).toBe(false);
  });

  it('returns while the merge runs and refuses a second merge', async () => {
    const runSectionMerge = jest.fn(() => new Promise(() => {}));
    (getEngine as jest.Mock).mockReturnValue({ runSectionMerge });
    const { result } = renderHook(() => useMergeSections());

    let first: Promise<string | null> | undefined;
    act(() => {
      first = result.current.merge('primary', 'donor');
    });
    expect(first).toBeInstanceOf(Promise);
    expect(result.current.isMerging).toBe(true);

    await act(async () => {
      expect(await result.current.merge('primary', 'donor')).toBeNull();
    });
    expect(runSectionMerge).toHaveBeenCalledTimes(1);
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('previews the dropped rides, and answers an empty list when the read fails', () => {
    const dropped = [{ activityId: 'a1', name: 'Morning ride', startDate: 1_710_200_000 }];
    const mergePreview = jest.fn().mockReturnValueOnce(dropped).mockReturnValueOnce(null);
    (getEngine as jest.Mock).mockReturnValue({ mergePreview });
    const { result } = renderHook(() => useMergeSections());

    expect(result.current.previewDropped('primary', 'donor')).toEqual(dropped);
    expect(result.current.previewDropped('donor', 'primary')).toEqual([]);
    expect(mergePreview).toHaveBeenLastCalledWith('donor', 'primary');
  });
});
