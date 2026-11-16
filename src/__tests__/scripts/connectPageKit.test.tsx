/**
 * Scenario: the connect page's kit gains dialogs, toasts with undo, tabs and
 * resizable split panes that a keyboard reaches.
 *
 * Expected behaviour: Tab wraps inside a dialog and Escape closes it; a
 * toast's undo runs its handler once and removes the toast; a drag changes the
 * stored pane width within its bounds and a double-click clears it; a tab's
 * choice is written to and read from the hash; arrow keys step menus and tabs.
 */

import { act, create } from 'react-test-renderer';

import {
  clampWidth,
  dialogKey,
  dismissToast,
  dividerKey,
  draggedWidth,
  loadWidth,
  pushToast,
  stepIndex,
  trapTarget,
  undoToast,
  type PaneStorage,
} from '../../../web/connect/ui/behaviour';
import { SplitPane } from '../../../web/connect/ui/SplitPane';
import { hashWithTab, tabFromHash } from '../../../web/connect/ui/Tabs';
import { ToastRegion } from '../../../web/connect/ui/Toast';

const control = () => ({ focus: jest.fn() });
const key = (name: string, shiftKey = false) => ({
  key: name,
  shiftKey,
  preventDefault: jest.fn(),
});

describe('dialog focus', () => {
  it('wraps Tab from the last control to the first and Shift+Tab the other way', () => {
    const [a, b, c] = [control(), control(), control()];
    expect(trapTarget([a, b, c], c, false)).toBe(a);
    expect(trapTarget([a, b, c], a, true)).toBe(c);
    expect(trapTarget([a, b, c], b, false)).toBeNull();
  });

  it('pulls focus in when it sits outside and holds it when nothing can take it', () => {
    const [a, b] = [control(), control()];
    expect(trapTarget([a, b], {}, false)).toBe(a);
    expect(trapTarget([a, b], {}, true)).toBe(b);
    expect(trapTarget([], {}, false)).toBeNull();
    const tab = key('Tab');
    expect(dialogKey(tab, [], null, jest.fn())).toBe(true);
    expect(tab.preventDefault).toHaveBeenCalled();
  });

  it('moves focus and stops the browser on a wrapping Tab, and closes on Escape', () => {
    const [a, b] = [control(), control()];
    const tab = key('Tab');
    dialogKey(tab, [a, b], b, jest.fn());
    expect(a.focus).toHaveBeenCalled();
    expect(tab.preventDefault).toHaveBeenCalled();
    const close = jest.fn();
    expect(dialogKey(key('Escape'), [a, b], a, close)).toBe(true);
    expect(close).toHaveBeenCalledTimes(1);
    expect(dialogKey(key('x'), [a, b], a, close)).toBe(false);
  });
});

describe('toasts', () => {
  const entry = (run: () => void) => ({ id: 1, message: 'Moved', undo: { label: 'Undo', run } });

  it('runs undo once and removes the toast', () => {
    const run = jest.fn();
    const after = undoToast([entry(run)], 1);
    expect(run).toHaveBeenCalledTimes(1);
    expect(after).toEqual([]);
    expect(undoToast(after, 1)).toEqual([]);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('keeps other toasts when one is dismissed and replaces one with the same id', () => {
    const list = pushToast(pushToast([], { id: 1, message: 'a' }), { id: 2, message: 'b' });
    expect(dismissToast(list, 1).map((t) => t.id)).toEqual([2]);
    expect(pushToast(list, { id: 2, message: 'c' }).map((t) => t.message)).toEqual(['a', 'c']);
  });

  it('draws an undo button that calls its handler', () => {
    const onUndo = jest.fn();
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <ToastRegion
          toasts={[entry(jest.fn())]}
          dismissLabel="Dismiss"
          onDismiss={jest.fn()}
          onUndo={onUndo}
        />
      );
    });
    const undo = tree.root.findAll(
      (n) => n.props.children === 'Undo' && typeof n.props.onClick === 'function'
    )[0];
    act(() => undo.props.onClick());
    expect(onUndo).toHaveBeenCalledWith(1);
  });
});

describe('split pane width', () => {
  const memory = (initial: Record<string, string> = {}) => {
    const held = { ...initial };
    const storage: PaneStorage = {
      getItem: (k) => held[k] ?? null,
      setItem: (k, v) => void (held[k] = v),
      removeItem: (k) => void delete held[k],
    };
    return { held, storage };
  };

  it('clamps a drag to its bounds and reads a stored width back within them', () => {
    expect(draggedWidth(300, 100, 160, 200, 400)).toBe(360);
    expect(draggedWidth(300, 100, 900, 200, 400)).toBe(400);
    expect(draggedWidth(300, 100, -900, 200, 400)).toBe(200);
    expect(clampWidth(250.6, 200, 400)).toBe(251);
    const { storage } = memory({ w: '9999', bad: 'wide' });
    expect(loadWidth(storage, 'w', 300, 200, 400)).toBe(400);
    expect(loadWidth(storage, 'bad', 300, 200, 400)).toBe(300);
    expect(loadWidth(storage, 'none', 300, 200, 400)).toBe(300);
    expect(loadWidth(null, 'w', 300, 200, 400)).toBe(300);
  });

  it('steps with the arrow keys and ends at the bounds', () => {
    expect(dividerKey('ArrowRight', 300, 16, 200, 400)).toBe(316);
    expect(dividerKey('ArrowLeft', 205, 16, 200, 400)).toBe(200);
    expect(dividerKey('End', 300, 16, 200, 400)).toBe(400);
    expect(dividerKey('a', 300, 16, 200, 400)).toBeNull();
  });

  it('keeps the dragged width in storage and clears it on a double-click', () => {
    const { held, storage } = memory({ split: '320' });
    let tree!: ReturnType<typeof create>;
    act(() => {
      tree = create(
        <SplitPane
          label="Resize"
          storageKey="split"
          defaultWidth={300}
          minWidth={200}
          maxWidth={400}
          first="a"
          second="b"
          storage={storage}
        />
      );
    });
    const divider = () => tree.root.findByProps({ role: 'separator' });
    expect(divider().props['aria-valuenow']).toBe(320);
    act(() => divider().props.onPointerDown({ clientX: 100, pointerId: 1, currentTarget: {} }));
    act(() => divider().props.onPointerMove({ clientX: 140 }));
    act(() => divider().props.onPointerUp({ clientX: 140 }));
    expect(held.split).toBe('360');
    expect(divider().props['aria-valuenow']).toBe(360);
    act(() => divider().props.onDoubleClick());
    expect(held.split).toBeUndefined();
    expect(divider().props['aria-valuenow']).toBe(300);
  });
});

describe('keyboard steps', () => {
  it('wraps menu and tab movement and jumps to the ends', () => {
    expect(stepIndex('ArrowDown', 2, 3)).toBe(0);
    expect(stepIndex('ArrowUp', 0, 3)).toBe(2);
    expect(stepIndex('ArrowRight', 0, 3, false)).toBe(1);
    expect(stepIndex('ArrowDown', 0, 3, false)).toBeNull();
    expect(stepIndex('End', 0, 3)).toBe(2);
    expect(stepIndex('Home', 2, 3)).toBe(0);
    expect(stepIndex('ArrowDown', 0, 0)).toBeNull();
  });

  it('keeps the chosen tab in the hash and falls back to the first for an unknown one', () => {
    const ids = ['summary', 'laps'];
    expect(tabFromHash('#/activity/7?tab=laps', 'tab', ids)).toBe('laps');
    expect(tabFromHash('#/activity/7?tab=nope', 'tab', ids)).toBe('summary');
    expect(tabFromHash('#/activity/7', 'tab', ids)).toBe('summary');
    expect(hashWithTab('#/activity/7?x=1', 'tab', 'laps')).toBe('#/activity/7?x=1&tab=laps');
    expect(hashWithTab('#/activity/7?tab=laps', 'tab', 'summary')).toBe('#/activity/7?tab=summary');
  });
});
