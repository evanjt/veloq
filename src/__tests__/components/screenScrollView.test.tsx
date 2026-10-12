/**
 * Scenario: a collapsing large title only works when the screen's scroll view lets the system
 * inset its content under the title, so content sits beneath the title at rest without it. A form
 * on it meets the keyboard, which resizes nothing on iOS or on an edge-to-edge Android screen, so
 * without help the field being typed into and the button under it sit behind the keyboard.
 *
 * Expected behaviour: `ScreenScrollView` sets automatic inset adjustment on iOS and nothing on
 * Android, a caller's own value wins, and `screenListInsets` is the same fact for a `FlatList`.
 * On iOS the scroll view insets itself for the keyboard. On Android it is padded by exactly the
 * part of it the keyboard covers, measured in window coordinates, and by nothing once the keyboard
 * hides. On both, a tap with the keyboard up reaches the control it lands on.
 */

import React, { createRef } from 'react';
import type {
  KeyboardEvent,
  ScrollView as ScrollViewType,
  StyleProp,
  ViewStyle,
} from 'react-native';

type KeyboardListener = (event: KeyboardEvent | null) => void;

/** Unmounts what each registry's renderer still holds. */
const cleanups: (() => void)[] = [];

/**
 * A fresh registry with React Native on `os`, and the module, renderer and safe area context all
 * loaded from it, so one copy of React serves every hook and `Platform` reads as `os` throughout.
 */
function loadFor(os: 'ios' | 'android') {
  jest.resetModules();
  const rn: typeof import('react-native') = require('react-native');
  rn.Platform.OS = os;
  const listeners = new Map<string, KeyboardListener[]>();
  jest.spyOn(rn.Keyboard, 'addListener').mockImplementation(((
    name: string,
    listener: KeyboardListener
  ) => {
    listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    return {
      remove: () =>
        listeners.set(
          name,
          (listeners.get(name) ?? []).filter((each) => each !== listener)
        ),
    };
  }) as never);
  // The pure entry adds no test hooks, which a require inside a test may not do.
  const rtl: typeof import('@testing-library/react-native') = require('@testing-library/react-native/pure');
  cleanups.push(rtl.cleanup);
  return {
    ...(require('@/shared/ui/ScreenScrollView') as typeof import('@/shared/ui/ScreenScrollView')),
    rn,
    rtl,
    SafeAreaProvider: (
      require('react-native-safe-area-context') as typeof import('react-native-safe-area-context')
    ).SafeAreaProvider,
    /** Fires the keyboard event the platform sends, to every listener the module added. */
    emit: (name: 'keyboardDidShow' | 'keyboardDidHide', event?: KeyboardEvent) =>
      rtl.act(() => (listeners.get(name) ?? []).forEach((listener) => listener(event ?? null))),
    /** Answers `measureInWindow` on every view as a view at `y` that is `height` tall. */
    measuredAt: (y: number, height: number) =>
      jest
        .spyOn(rn.View.prototype as never, 'measureInWindow')
        .mockImplementation(((callback: (x: number, y: number, w: number, h: number) => void) =>
          callback(0, y, 360, height)) as never),
  };
}

type Loaded = ReturnType<typeof loadFor>;

/** A keyboard whose top edge is `screenY` points from the top of the screen. */
function keyboardAt(screenY: number): KeyboardEvent {
  return {
    duration: 0,
    easing: 'keyboard',
    endCoordinates: { screenX: 0, screenY, width: 360, height: 640 - screenY },
  } as KeyboardEvent;
}

const statusBar = {
  frame: { x: 0, y: 0, width: 360, height: 640 },
  insets: { top: 24, right: 0, bottom: 0, left: 0 },
};

/** A form on the screen scroll view under a 24 point status bar, and its outermost padding. */
async function renderForm(ui: Loaded) {
  const { ScreenScrollView, SafeAreaProvider, rn, rtl } = ui;
  const tree = await rtl.render(
    <SafeAreaProvider initialMetrics={statusBar}>
      <ScreenScrollView>
        <rn.Text>x</rn.Text>
      </ScreenScrollView>
    </SafeAreaProvider>
  );
  return () => {
    const root = tree.toJSON() as { props: { style?: StyleProp<ViewStyle> } };
    return rn.StyleSheet.flatten(root.props.style)?.paddingBottom;
  };
}

/** The props the rendered scroll view carries. */
async function scrollProps(ui: Loaded, element: React.ReactElement) {
  return (await ui.rtl.render(element)).UNSAFE_getByType(ui.rn.ScrollView).props;
}

afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  jest.restoreAllMocks();
});

describe('ScreenScrollView', () => {
  it('sets automatic inset adjustment on iOS', async () => {
    const ui = loadFor('ios');
    const props = await scrollProps(
      ui,
      <ui.ScreenScrollView>
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    expect(props.contentInsetAdjustmentBehavior).toBe('automatic');
  });

  it('sets no inset adjustment on Android', async () => {
    const ui = loadFor('android');
    const props = await scrollProps(
      ui,
      <ui.ScreenScrollView>
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    expect(props).not.toHaveProperty('contentInsetAdjustmentBehavior');
  });

  it("lets the caller's own value win on iOS", async () => {
    const ui = loadFor('ios');
    const props = await scrollProps(
      ui,
      <ui.ScreenScrollView contentInsetAdjustmentBehavior="never">
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    expect(props.contentInsetAdjustmentBehavior).toBe('never');
  });

  it('forwards the other props and the ref to the scroll view', async () => {
    const ui = loadFor('ios');
    const ref = createRef<ScrollViewType>();
    const { getByTestId } = await ui.rtl.render(
      <ui.ScreenScrollView ref={ref} testID="body" showsVerticalScrollIndicator={false}>
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    expect(getByTestId('body').props.showsVerticalScrollIndicator).toBe(false);
    expect(ref.current).not.toBeNull();
  });
});

describe('ScreenScrollView and the keyboard', () => {
  it('insets itself for the keyboard on iOS, and lets a tap through', async () => {
    const ui = loadFor('ios');
    const props = await scrollProps(
      ui,
      <ui.ScreenScrollView>
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    expect(props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(props.keyboardShouldPersistTaps).toBe('handled');
    expect(props.keyboardDismissMode).toBe('interactive');
  });

  it('adds no wrapper on iOS, where the scroll view does the work', async () => {
    const ui = loadFor('ios');
    const { toJSON } = await ui.rtl.render(
      <ui.ScreenScrollView testID="body">
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    expect((toJSON() as { props: { testID?: string } }).props.testID).toBe('body');
  });

  it('lets a tap through and puts the keyboard away on a drag on Android', async () => {
    const ui = loadFor('android');
    const props = await scrollProps(
      ui,
      <ui.ScreenScrollView>
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    expect(props.keyboardShouldPersistTaps).toBe('handled');
    expect(props.keyboardDismissMode).toBe('on-drag');
    expect(props).not.toHaveProperty('automaticallyAdjustKeyboardInsets');
  });

  it('pads by the part the keyboard covers on Android, counting the status bar', async () => {
    const ui = loadFor('android');
    // Measured from under the status bar: the view spans 124 to 624 on screen.
    ui.measuredAt(100, 500);
    const padding = await renderForm(ui);

    expect(padding()).toBe(0);

    await ui.emit('keyboardDidShow', keyboardAt(340));

    expect(padding()).toBe(284);

    await ui.emit('keyboardDidHide');

    expect(padding()).toBe(0);

    await ui.emit('keyboardDidShow', keyboardAt(400));

    expect(padding()).toBe(224);
  });

  it('pads nothing on Android for a view that ends at the keyboard or above it', async () => {
    const ui = loadFor('android');
    ui.measuredAt(0, 316);
    const padding = await renderForm(ui);

    await ui.emit('keyboardDidShow', keyboardAt(340));

    expect(padding()).toBe(0);
  });

  it('stops listening once the screen unmounts', async () => {
    const ui = loadFor('android');
    ui.measuredAt(100, 500);
    const tree = await ui.rtl.render(
      <ui.ScreenScrollView>
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    await tree.unmount();

    await ui.emit('keyboardDidShow', keyboardAt(340));
    expect(ui.rn.View.prototype.measureInWindow).not.toHaveBeenCalled();
  });

  it("lets the caller's own keyboard props win", async () => {
    const ui = loadFor('ios');
    const props = await scrollProps(
      ui,
      <ui.ScreenScrollView keyboardShouldPersistTaps="never" keyboardDismissMode="none">
        <ui.rn.Text>x</ui.rn.Text>
      </ui.ScreenScrollView>
    );

    expect(props.keyboardShouldPersistTaps).toBe('never');
    expect(props.keyboardDismissMode).toBe('none');
  });
});

describe('screenListInsets', () => {
  it('carries automatic inset adjustment and the keyboard defaults on iOS, onto a FlatList', async () => {
    const ui = loadFor('ios');
    const props = await scrollProps(
      ui,
      <ui.rn.FlatList data={['a']} renderItem={() => null} {...ui.screenListInsets} />
    );

    expect(props.contentInsetAdjustmentBehavior).toBe('automatic');
    expect(props.automaticallyAdjustKeyboardInsets).toBe(true);
    expect(props.keyboardShouldPersistTaps).toBe('handled');
  });

  it('carries only the keyboard defaults on Android', () => {
    expect(loadFor('android').screenListInsets).toEqual({
      keyboardShouldPersistTaps: 'handled',
      keyboardDismissMode: 'on-drag',
    });
  });
});
