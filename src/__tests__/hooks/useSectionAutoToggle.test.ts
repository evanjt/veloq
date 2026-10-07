import { act, renderHook } from '@testing-library/react-native';
import { useSectionAutoToggle } from '@/features/maps/hooks/useSectionAutoToggle';

const camera = (zoom: number) => ({ center: [7.45, 46.95] as [number, number], zoom }) as never;

function setup(holdSections?: boolean, enabled?: boolean, showSections = true) {
  const setShowSections = jest.fn();
  const { result } = renderHook(() =>
    useSectionAutoToggle({
      showSections,
      enabled,
      setShowSections,
      baseHandleRegionDidChange: jest.fn(),
      baseToggleSections: jest.fn(),
      holdSections,
    })
  );
  return { result, setShowSections };
}

describe('useSectionAutoToggle', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  /**
   * Scenario: a link opens the map on a section popup, and the first camera
   * settle lands below the zoom the overlay auto-hides at.
   *
   * Expected behaviour: the overlay stays shown, so the popup survives.
   */
  it('keeps sections shown when zoomed out while a section is held open', () => {
    const { result, setShowSections } = setup(true);

    act(() => {
      result.current.handleRegionDidChange(camera(9));
      jest.advanceTimersByTime(500);
    });

    expect(setShowSections).not.toHaveBeenCalled();
  });

  it('never shows sections on a zoom in while they are switched off', () => {
    const { result, setShowSections } = setup(false, false, false);

    act(() => {
      result.current.handleRegionDidChange(camera(14));
      jest.advanceTimersByTime(500);
    });

    expect(setShowSections).not.toHaveBeenCalled();
  });

  it('hides sections below the hide zoom when nothing is held open', () => {
    const { result, setShowSections } = setup();

    act(() => {
      result.current.handleRegionDidChange(camera(9));
      jest.advanceTimersByTime(500);
    });

    expect(setShowSections).toHaveBeenCalledWith(false);
  });

  /**
   * Scenario: a region change arms the settle timer, then the athlete taps the
   * sections button before it fires.
   *
   * Expected behaviour: the pending auto-toggle is dropped and the manual
   * choice stands, in both directions.
   */
  it.each([
    ['hidden at high zoom', 14, false],
    ['shown at low zoom', 9, true],
  ])(
    'drops a pending auto-toggle when the athlete toggles manually (%s)',
    (_name, zoom, shownAfterToggle) => {
      const setShowSections = jest.fn();
      const baseToggleSections = jest.fn();
      const { result, rerender } = renderHook(
        ({ shown }: { shown: boolean }) =>
          useSectionAutoToggle({
            showSections: shown,
            setShowSections,
            baseHandleRegionDidChange: jest.fn(),
            baseToggleSections,
          }),
        { initialProps: { shown: !shownAfterToggle } }
      );

      act(() => {
        result.current.handleRegionDidChange(camera(zoom));
      });
      act(() => {
        result.current.toggleSections();
      });
      rerender({ shown: shownAfterToggle });
      act(() => {
        jest.advanceTimersByTime(500);
      });

      expect(setShowSections).not.toHaveBeenCalled();
    }
  );

  it('clears a pending auto-toggle on unmount', () => {
    const setShowSections = jest.fn();
    const view = renderHook(() =>
      useSectionAutoToggle({
        showSections: true,
        setShowSections,
        baseHandleRegionDidChange: jest.fn(),
        baseToggleSections: jest.fn(),
      })
    );
    act(() => {
      view.result.current.handleRegionDidChange(camera(9));
    });
    view.unmount();
    act(() => {
      jest.advanceTimersByTime(500);
    });
    expect(setShowSections).not.toHaveBeenCalled();
  });
});
