import { act, renderHook } from '@testing-library/react-native';
import { Alert } from 'react-native';
import type { TFunction } from 'i18next';

import { useRouteReference } from '@/features/routes/hooks/useRouteReference';
import { getEngine } from '@/shared/native/engine';

jest.mock('@/shared/native/engine', () => ({ getEngine: jest.fn() }));

const translate = ((key: string) => key) as TFunction;

describe('useRouteReference', () => {
  it('offers reset when the current reference is tapped', () => {
    const resetRouteRepresentative = jest.fn().mockReturnValue(true);
    jest.mocked(getEngine).mockReturnValue({ resetRouteRepresentative } as never);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'common.reset')?.onPress?.();
    });
    const { result } = renderHook(() => useRouteReference('r_1', 'A', translate));

    act(() => result.current.handleSetAsReference('A'));

    expect(alert).toHaveBeenCalledWith(
      'routes.resetReference',
      'routes.resetReferenceConfirm',
      expect.any(Array)
    );
    expect(resetRouteRepresentative).toHaveBeenCalledWith('r_1');
    alert.mockRestore();
  });

  it('follows the representative refreshed by the engine after a regroup', () => {
    const setRouteRepresentative = jest.fn().mockReturnValue(true);
    jest.mocked(getEngine).mockReturnValue({ setRouteRepresentative } as never);
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => {
      buttons?.find((button) => button.text === 'common.confirm')?.onPress?.();
    });
    const { result, rerender } = renderHook(
      ({ representativeId }: { representativeId: string }) =>
        useRouteReference('r_1', representativeId, translate),
      { initialProps: { representativeId: 'A' } }
    );

    act(() => result.current.handleSetAsReference('C'));
    rerender({ representativeId: 'C' });
    expect(result.current.effectiveRepresentativeId).toBe('C');
    rerender({ representativeId: 'B' });
    expect(result.current.effectiveRepresentativeId).toBe('B');
    alert.mockRestore();
  });
});
