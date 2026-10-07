import { Alert } from 'react-native';
import { act, renderHook } from '@testing-library/react-native';
import { useSectionTrim } from '@/features/routes/hooks/useSectionTrim';
import { getEngine } from '@/shared/native/engine';
import type { FrequentSection } from '@/types';

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
  useQueryClient: () => ({ invalidateQueries: jest.fn() }),
}));

const polyline = Array.from({ length: 20 }, (_, i) => ({ lat: 46 + i * 0.0001, lng: 7 }));
const section = { id: 'sec1', polyline, distanceMeters: 200 } as unknown as FrequentSection;
const ride = { activityId: 'a1', name: 'Morning ride', date: 1_710_200_000 };

function trimWith(departed: unknown[] | null) {
  const engine = {
    trimSection: jest.fn(() => departed),
    resetSectionBounds: jest.fn(() => departed),
  };
  (getEngine as jest.Mock).mockReturnValue(engine);
  const onRefresh = jest.fn();
  const hook = renderHook(() => useSectionTrim(section, onRefresh, true));
  act(() => hook.result.current.startTrim());
  act(() => hook.result.current.setTrimStart(2));
  act(() => hook.result.current.setTrimEnd(15));
  return { hook, engine, onRefresh };
}

describe('useSectionTrim departed rides', () => {
  beforeEach(() => jest.spyOn(Alert, 'alert').mockImplementation(() => {}));
  afterEach(() => jest.restoreAllMocks());

  it('names the ride the trim took out of the section', () => {
    const { hook, onRefresh } = trimWith([ride]);

    act(() => hook.result.current.confirmTrim());

    expect(onRefresh).toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).toContain('Morning ride');
  });

  it('shows nothing when the trim took no ride out', () => {
    const { hook, onRefresh } = trimWith([]);

    act(() => hook.result.current.confirmTrim());

    expect(onRefresh).toHaveBeenCalled();
    expect(Alert.alert).not.toHaveBeenCalled();
  });

  it('shows the failure and no ride when the trim failed', () => {
    const { hook, onRefresh } = trimWith(null);

    act(() => hook.result.current.confirmTrim());

    expect(onRefresh).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledTimes(1);
    expect((Alert.alert as jest.Mock).mock.calls[0][1]).not.toContain('Morning ride');
  });
});
