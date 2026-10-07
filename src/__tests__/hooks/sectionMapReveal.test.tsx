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

function setup(initial: string | number | null | undefined) {
  const scrollTo = jest.fn();
  const scrollRef = { current: { scrollTo } };
  const view = renderHook(
    ({ target }: { target: string | number | null | undefined }) =>
      useRevealMapOnDraw(scrollRef as never, target),
    {
      initialProps: { target: initial },
    }
  );
  return { scrollTo, ...view };
}

describe('useRevealMapOnDraw', () => {
  it('does not scroll on mount with nothing drawn', () => {
    const { scrollTo } = setup(null);
    expect(scrollTo).not.toHaveBeenCalled();
  });

  it('scrolls to the top when a target is set', () => {
    const { scrollTo, rerender } = setup(null);
    rerender({ target: 'activity-1' });
    expect(scrollTo).toHaveBeenCalledTimes(1);
    expect(scrollTo).toHaveBeenCalledWith({ y: 0, animated: true });
  });

  it('scrolls again when the target changes to another', () => {
    const { scrollTo, rerender } = setup('a');
    rerender({ target: 'b' });
    expect(scrollTo).toHaveBeenCalledTimes(2);
  });

  it('does not scroll when the target is cleared or unchanged', () => {
    const { scrollTo, rerender } = setup(null);
    rerender({ target: 3 });
    scrollTo.mockClear();
    rerender({ target: 3 });
    rerender({ target: null });
    rerender({ target: undefined });
    expect(scrollTo).not.toHaveBeenCalled();
  });
});
