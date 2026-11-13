import { renderHook, act } from '@testing-library/react-native';

import { useSettleCamera } from '@/features/maps/lib/useSettleCamera';

const open = { top: 10, right: 10, bottom: 10, left: 10 };
const raised = { top: 10, right: 10, bottom: 300, left: 10 };

function setup(ready: boolean) {
  const settleInset = jest.fn();
  const surface = { current: { settleInset } };
  const hook = renderHook(
    ({ inset, isReady }: { inset: typeof open; isReady: boolean }) =>
      useSettleCamera(inset, surface, isReady),
    { initialProps: { inset: open, isReady: ready } }
  );
  return { settleInset, hook };
}

describe('useSettleCamera', () => {
  it('refits an untouched map when the inset changes', () => {
    const { settleInset, hook } = setup(true);
    hook.rerender({ inset: raised, isReady: true });
    expect(settleInset).toHaveBeenCalledWith({ kind: 'refit', padding: raised });
  });

  it('eases a map the athlete moved', () => {
    const { settleInset, hook } = setup(true);
    act(() => hook.result.current.markMoved());
    hook.rerender({ inset: raised, isReady: true });
    expect(settleInset).toHaveBeenCalledWith({ kind: 'ease', padding: raised });
  });

  it('sends the settle a booting surface missed once it is ready', () => {
    const { settleInset, hook } = setup(false);
    hook.rerender({ inset: raised, isReady: false });
    expect(settleInset).not.toHaveBeenCalled();
    hook.rerender({ inset: raised, isReady: true });
    expect(settleInset).toHaveBeenCalledTimes(1);
    expect(settleInset).toHaveBeenCalledWith({ kind: 'refit', padding: raised });
  });

  it('sends one move to the last inset after several settles while booting', () => {
    const { settleInset, hook } = setup(false);
    const mid = { ...raised, bottom: 150 };
    hook.rerender({ inset: mid, isReady: false });
    hook.rerender({ inset: raised, isReady: false });
    hook.rerender({ inset: raised, isReady: true });
    expect(settleInset).toHaveBeenCalledTimes(1);
    expect(settleInset).toHaveBeenCalledWith({ kind: 'refit', padding: raised });
  });

  it('sends nothing when the inset returns to the built one while booting', () => {
    const { settleInset, hook } = setup(false);
    hook.rerender({ inset: raised, isReady: false });
    hook.rerender({ inset: { ...open }, isReady: false });
    hook.rerender({ inset: { ...open }, isReady: true });
    expect(settleInset).not.toHaveBeenCalled();
  });

  it('sends nothing when the surface turns ready with no inset change', () => {
    const { settleInset, hook } = setup(false);
    hook.rerender({ inset: open, isReady: true });
    expect(settleInset).not.toHaveBeenCalled();
  });

  it('does not read a move before the surface is ready as the athlete', () => {
    const { settleInset, hook } = setup(false);
    act(() => hook.result.current.markMoved());
    hook.rerender({ inset: open, isReady: true });
    hook.rerender({ inset: raised, isReady: true });
    expect(settleInset).toHaveBeenCalledWith({ kind: 'refit', padding: raised });
  });
});
