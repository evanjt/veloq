import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { TFunction } from 'i18next';

import { useRouteReference } from '@/features/routes/hooks/useRouteReference';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const translate = ((key: string) => key) as TFunction;

describe('useRouteReference', () => {
  it('offers reset when the current reference is tapped', async () => {
    const resetRouteRepresentative = jest.fn().mockReturnValue(true);
    jest.mocked(getEngine).mockReturnValue({ resetRouteRepresentative } as never);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'common.reset')?.onPress?.();
    });
    const { result } = await renderHook(() => useRouteReference('r_1', 'A', translate));

    await act(() => result.current.handleSetAsReference('A'));

    expect(alert).toHaveBeenCalledWith(
      'routes.resetReference',
      'routes.resetReferenceConfirm',
      expect.any(Array),
      expect.objectContaining({ cancelable: true })
    );
    expect(resetRouteRepresentative).toHaveBeenCalledWith('r_1');
    alert.mockRestore();
  });

  it('follows the representative refreshed by the engine after a regroup', async () => {
    const setRouteRepresentative = jest.fn().mockReturnValue(true);
    jest.mocked(getEngine).mockReturnValue({ setRouteRepresentative } as never);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'routes.setAsReference')?.onPress?.();
    });
    const { result, rerender } = await renderHook(
      ({ representativeId }: { representativeId: string }) =>
        useRouteReference('r_1', representativeId, translate),
      { initialProps: { representativeId: 'A' } }
    );

    await act(() => result.current.handleSetAsReference('C'));
    await rerender({ representativeId: 'C' });
    expect(result.current.effectiveRepresentativeId).toBe('C');
    await rerender({ representativeId: 'B' });
    expect(result.current.effectiveRepresentativeId).toBe('B');
    alert.mockRestore();
  });

  describe('a refused change', () => {
    const confirmWith = (label: string) =>
      jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
        buttons?.find((button) => button.text === label)?.onPress?.();
      });

    const informedTitles = (alert: jest.SpyInstance) =>
      alert.mock.calls
        .map(([title]) => title)
        .filter((title) => title === 'routes.referenceFailedTitle');

    afterEach(() => jest.restoreAllMocks());

    it('says so when the engine refuses a new reference', async () => {
      const setRouteRepresentative = jest.fn().mockResolvedValue(false);
      jest.mocked(getEngine).mockReturnValue({ setRouteRepresentative } as never);
      const alert = confirmWith('routes.setAsReference');
      const { result } = await renderHook(() => useRouteReference('r_1', 'A', translate));

      await act(async () => result.current.handleSetAsReference('C'));

      expect(setRouteRepresentative).toHaveBeenCalledWith('r_1', 'C');
      expect(informedTitles(alert)).toHaveLength(1);
      expect(alert).toHaveBeenLastCalledWith(
        'routes.referenceFailedTitle',
        'routes.referenceFailedMessage',
        undefined,
        expect.anything()
      );
    });

    it('stays quiet when the engine takes a new reference', async () => {
      const setRouteRepresentative = jest.fn().mockResolvedValue(true);
      jest.mocked(getEngine).mockReturnValue({ setRouteRepresentative } as never);
      const alert = confirmWith('routes.setAsReference');
      const { result } = await renderHook(() => useRouteReference('r_1', 'A', translate));

      await act(async () => result.current.handleSetAsReference('C'));

      expect(setRouteRepresentative).toHaveBeenCalledWith('r_1', 'C');
      expect(informedTitles(alert)).toHaveLength(0);
    });

    it('says so when the engine refuses a reset', async () => {
      const resetRouteRepresentative = jest.fn().mockResolvedValue(false);
      jest.mocked(getEngine).mockReturnValue({ resetRouteRepresentative } as never);
      const alert = confirmWith('common.reset');
      const { result } = await renderHook(() => useRouteReference('r_1', 'A', translate));

      await act(async () => result.current.handleSetAsReference('A'));

      expect(resetRouteRepresentative).toHaveBeenCalledWith('r_1');
      expect(informedTitles(alert)).toHaveLength(1);
    });

    it('stays quiet when the engine takes a reset', async () => {
      const resetRouteRepresentative = jest.fn().mockResolvedValue(true);
      jest.mocked(getEngine).mockReturnValue({ resetRouteRepresentative } as never);
      const alert = confirmWith('common.reset');
      const { result } = await renderHook(() => useRouteReference('r_1', 'A', translate));

      await act(async () => result.current.handleSetAsReference('A'));

      expect(informedTitles(alert)).toHaveLength(0);
    });

    it('says so when the engine is not open', async () => {
      jest.mocked(getEngine).mockReturnValue(null as never);
      const alert = confirmWith('routes.setAsReference');
      const { result } = await renderHook(() => useRouteReference('r_1', 'A', translate));

      await act(async () => result.current.handleSetAsReference('C'));

      expect(informedTitles(alert)).toHaveLength(1);
    });

    it('says so when the write throws', async () => {
      const setRouteRepresentative = jest.fn().mockRejectedValue(new Error('closed'));
      jest.mocked(getEngine).mockReturnValue({ setRouteRepresentative } as never);
      const alert = confirmWith('routes.setAsReference');
      const { result } = await renderHook(() => useRouteReference('r_1', 'A', translate));

      await act(async () => result.current.handleSetAsReference('C'));

      expect(informedTitles(alert)).toHaveLength(1);
    });

    it('refuses a second change while one runs', async () => {
      let finish: (taken: boolean) => void = () => {};
      const setRouteRepresentative = jest.fn(
        () => new Promise<boolean>((resolve) => (finish = resolve))
      );
      jest.mocked(getEngine).mockReturnValue({ setRouteRepresentative } as never);
      const alert = confirmWith('routes.setAsReference');
      const { result } = await renderHook(() => useRouteReference('r_1', 'A', translate));

      await act(async () => result.current.handleSetAsReference('C'));
      await act(async () => result.current.handleSetAsReference('D'));
      expect(setRouteRepresentative).toHaveBeenCalledTimes(1);

      await act(async () => finish(true));
      await act(async () => result.current.handleSetAsReference('D'));
      expect(setRouteRepresentative).toHaveBeenCalledTimes(2);
      expect(setRouteRepresentative).toHaveBeenLastCalledWith('r_1', 'D');
      expect(informedTitles(alert)).toHaveLength(0);
    });
  });
});
