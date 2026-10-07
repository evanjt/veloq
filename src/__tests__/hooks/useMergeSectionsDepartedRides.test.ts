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

  it('returns the kept section and names the ride that left in the merge', () => {
    (getEngine as jest.Mock).mockReturnValue({
      mergeSections: jest.fn(() => ({ sectionId: 'primary', departed: [ride] })),
    });
    const { result } = renderHook(() => useMergeSections());

    let kept: string | null = null;
    act(() => {
      kept = result.current.merge('primary', 'donor');
    });

    expect(kept).toBe('primary');
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('Morning ride');
  });

  it('shows nothing when no ride left, and returns null when the merge failed', () => {
    const mergeSections = jest
      .fn()
      .mockReturnValueOnce({ sectionId: 'primary', departed: [] })
      .mockReturnValueOnce(null);
    (getEngine as jest.Mock).mockReturnValue({ mergeSections });
    const { result } = renderHook(() => useMergeSections());

    act(() => {
      expect(result.current.merge('primary', 'donor')).toBe('primary');
      expect(result.current.merge('primary', 'donor')).toBeNull();
    });

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
