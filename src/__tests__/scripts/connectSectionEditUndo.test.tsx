/**
 * Scenario: a section edit on the connect site raises a toast with an undo.
 *
 * Expected behaviour: a toast with an undo lives 10 s and one without 6 s, a pointer or focus
 * inside the region holds every toast until it leaves, lifting a section on or off sends the
 * opposite flag as its undo, a merge's undo puts back both sections, and a dirty bounds draft
 * asks before Escape discards it.
 */

import { act, create } from 'react-test-renderer';

import {
  toastLifetime,
  TOAST_LIFETIME_MS,
  UNDO_TOAST_LIFETIME_MS,
} from '../../../web/connect/ui/behaviour';
import { ToastProvider, useToast } from '../../../web/connect/ui';
import {
  escapeAction,
  liftWrites,
  mergeUndoWrites,
  shownBounds,
} from '../../../web/connect/sectionBounds';

describe('toast lifetime', () => {
  it('keeps a toast with an undo for 10 s and one without for 6 s', () => {
    expect(UNDO_TOAST_LIFETIME_MS).toBe(10_000);
    expect(toastLifetime({ id: 1, message: 'a' })).toBe(TOAST_LIFETIME_MS);
    expect(toastLifetime({ id: 1, message: 'a', undo: { label: 'Undo', run: jest.fn() } })).toBe(
      UNDO_TOAST_LIFETIME_MS
    );
  });
});

describe('toast hold', () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  function Raise() {
    const notify = useToast();
    return <button id="raise" onClick={() => notify('Saved', { label: 'Undo', run: jest.fn() })} />;
  }

  const mount = () => {
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ToastProvider dismissLabel="Dismiss">
          <Raise />
        </ToastProvider>
      );
    });
    act(() => tree.root.findByProps({ id: 'raise' }).props.onClick());
    return tree;
  };
  const shown = (tree: ReturnType<typeof create>) =>
    tree.root.findAll((n) => n.props.className === 'ui-toast').length;

  it('dismisses an undo toast after its lifetime when nothing holds it', () => {
    const tree = mount();
    act(() => jest.advanceTimersByTime(UNDO_TOAST_LIFETIME_MS - 1));
    expect(shown(tree)).toBe(1);
    act(() => jest.advanceTimersByTime(1));
    expect(shown(tree)).toBe(0);
  });

  it('holds the toast while the pointer is over the region and restarts the lifetime after', () => {
    const tree = mount();
    const region = tree.root.findByProps({ role: 'status' });
    act(() => region.props.onMouseEnter());
    act(() => jest.advanceTimersByTime(UNDO_TOAST_LIFETIME_MS * 3));
    expect(shown(tree)).toBe(1);
    act(() => region.props.onMouseLeave());
    act(() => jest.advanceTimersByTime(UNDO_TOAST_LIFETIME_MS - 1));
    expect(shown(tree)).toBe(1);
    act(() => jest.advanceTimersByTime(1));
    expect(shown(tree)).toBe(0);
  });

  it('holds the toast while focus is inside the region', () => {
    const tree = mount();
    const region = tree.root.findByProps({ role: 'status' });
    act(() => region.props.onFocus());
    act(() => jest.advanceTimersByTime(UNDO_TOAST_LIFETIME_MS * 3));
    expect(shown(tree)).toBe(1);
    act(() => region.props.onBlur());
    act(() => jest.advanceTimersByTime(UNDO_TOAST_LIFETIME_MS));
    expect(shown(tree)).toBe(0);
  });
});

describe('liftWrites', () => {
  it('sends the flag asked for and the opposite flag as its undo', () => {
    expect(liftWrites('s1', true)).toEqual({
      writes: [{ method: 'section.setLift', params: { id: 's1', isLift: true } }],
      undo: [{ method: 'section.setLift', params: { id: 's1', isLift: false } }],
    });
    expect(liftWrites('s1', false).undo).toEqual([
      { method: 'section.setLift', params: { id: 's1', isLift: true } },
    ]);
  });
});

describe('mergeUndoWrites', () => {
  it('restores the merged section and puts the kept one back on the line it had', () => {
    const revert = [
      { method: 'section.editBounds', params: { id: 'a', edit: 'revert', version: 2 } },
    ];
    expect(mergeUndoWrites('b', revert as never)).toEqual([
      { method: 'section.restore', params: { id: 'b' } },
      ...revert,
    ]);
  });

  it('still restores the merged section when the kept one has no readable ledger', () => {
    expect(mergeUndoWrites('b', [])).toEqual([{ method: 'section.restore', params: { id: 'b' } }]);
  });
});

describe('escapeAction', () => {
  it('closes a draft that changed nothing and asks about one that did', () => {
    expect(escapeAction(false)).toBe('close');
    expect(escapeAction(true)).toBe('confirm');
  });
});

describe('shownBounds', () => {
  const stored = { distanceMeters: 2900, avgGradePercent: 4.0 };

  it("reads the engine's stored distance and grade while the ends are where the section has them", () => {
    expect(shownBounds(true, stored, null)).toEqual({ metres: 2900, slope: 4.0 });
  });

  it("reads the engine's preview once the ends have moved", () => {
    expect(
      shownBounds(false, stored, { distanceMeters: 2400, avgGradePercent: 3.1, lapsRemeasured: 3 })
    ).toEqual({ metres: 2400, slope: 3.1 });
  });

  it('shows no figure for moved ends the engine has not measured, and no grade for a line with none', () => {
    expect(shownBounds(false, stored, null)).toEqual({ metres: null, slope: null });
    expect(
      shownBounds(false, stored, { distanceMeters: 2400, avgGradePercent: null, lapsRemeasured: 0 })
    ).toEqual({ metres: 2400, slope: null });
  });
});
