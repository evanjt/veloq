/**
 * Scenario: the section page draws on a hero map at the top of a long scroll.
 * A lap tap, a PR tap or Show on map in History sets what the map draws while
 * the athlete is far down the page.
 *
 * Expected behaviour: a new drawing target scrolls the page back to the map.
 * Clearing the target, or leaving it unchanged on a re-render, does not move
 * the page.
 */

import { renderHook } from '@testing-library/react-native';

import { useRevealMapOnDraw } from '@/features/routes/hooks/useRevealMapOnDraw';

async function setup(initial: string | number | null | undefined) {
  const scrollTo = jest.fn();
  const scrollRef = { current: { scrollTo } };
  const view = await renderHook(
    ({ target }: { target: string | number | null | undefined }) =>
      useRevealMapOnDraw(scrollRef as never, target),
    {
      initialProps: { target: initial },
    }
  );
  return { scrollTo, ...view };
}

describe('useRevealMapOnDraw', () => {
  it('does not scroll on mount with nothing drawn', async () => {
    const { scrollTo } = await setup(null);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls to the top when a target is set', async () => {
    const { scrollTo, rerender } = await setup(null);
    await rerender({ target: 'activity-1' });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('scrolls again when the target changes to another', async () => {
    const { scrollTo, rerender } = await setup('a');
    await rerender({ target: 'b' });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('does not scroll when the target is cleared or unchanged', async () => {
    const { scrollTo, rerender } = await setup(null);
    await rerender({ target: 3 });
    scrollTo.mockClear();
    await rerender({ target: 3 });
    await rerender({ target: null });
    await rerender({ target: undefined });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
