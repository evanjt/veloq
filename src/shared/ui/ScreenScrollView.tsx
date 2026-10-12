/**
 * The scroll view of a screen under a native stack header, and of every form.
 *
 * A collapsing large title on iOS only works when the screen's scroll view lets the system inset
 * its content, otherwise the content sits under the title at rest. This sets that once for the
 * routes that take a large title in `screenHeaders`. Android has no such inset, so it gets none.
 *
 * It also owns how a form meets the keyboard, so the field being edited and the action under it
 * stay above it. iOS never resizes for the keyboard, so the scroll view insets itself for it.
 * Android draws edge to edge, so nothing resizes there either, and the scroll view is padded by
 * the part of it the keyboard covers. A tap on a button with the keyboard up reaches the button
 * rather than only dismissing the keyboard, and a drag puts the keyboard away.
 * A prop the caller passes wins over the default.
 */

import React, { forwardRef, useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  Keyboard,
  Platform,
  ScrollView,
  StyleSheet,
  View,
  type KeyboardEvent,
  type ScrollViewProps,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/** Whether the keyboard has to be cleared by padding, read once like the defaults below. */
const padsForKeyboard = Platform.OS === 'android';

type ScreenScrollDefaults = Pick<
  ScrollViewProps,
  | 'contentInsetAdjustmentBehavior'
  | 'automaticallyAdjustKeyboardInsets'
  | 'keyboardShouldPersistTaps'
  | 'keyboardDismissMode'
>;

/**
 * The keyboard defaults alone, for a form's scroll view that is not a screen's, such as the body
 * of a native sheet, which moves for the keyboard itself on Android.
 */
export const formKeyboardProps: ScreenScrollDefaults = padsForKeyboard
  ? { keyboardShouldPersistTaps: 'handled', keyboardDismissMode: 'on-drag' }
  : {
      automaticallyAdjustKeyboardInsets: true,
      keyboardShouldPersistTaps: 'handled',
      keyboardDismissMode: 'interactive',
    };

/**
 * The same defaults for a screen whose body is a `FlatList`, a `SectionList` or another library's
 * `ScrollView`: spread it onto that view, and wrap it in `KeyboardClearance` when it holds a field.
 * `lint:large-title-scroll` looks for this name on one of them in a large-title route.
 */
export const screenListInsets: ScreenScrollDefaults =
  Platform.OS === 'ios'
    ? { contentInsetAdjustmentBehavior: 'automatic', ...formKeyboardProps }
    : formKeyboardProps;

/** How far a view whose top and height are given reaches below the keyboard's top edge. */
function keyboardOverlap(viewTop: number, viewHeight: number, keyboardTop: number): number {
  return Math.max(0, viewTop + viewHeight - keyboardTop);
}

/**
 * On Android, pads its children by the part of it the keyboard covers, and is a plain wrapper on
 * iOS, where the scroll view insets itself. The overlap is measured in window coordinates rather
 * than from the parent's layout, so it holds under a native header and anywhere down the tree.
 * Android measures a view from the visible frame, which starts under the status bar, while the
 * keyboard's top is reported from the top of the screen, so the top inset is added back.
 */
export function KeyboardClearance({ children }: { children: ReactNode }) {
  return padsForKeyboard ? <KeyboardPadding>{children}</KeyboardPadding> : <>{children}</>;
}

function KeyboardPadding({ children }: { children: ReactNode }) {
  const ref = useRef<View>(null);
  const keyboard = useRef<KeyboardEvent | null>(null);
  const { top } = useSafeAreaInsets();
  const [bottom, setBottom] = useState(0);

  const measure = useCallback(() => {
    const event = keyboard.current;
    if (!event) {
      setBottom(0);
      return;
    }
    ref.current?.measureInWindow((_x, y, _width, height) => {
      if (keyboard.current !== event) return;
      setBottom(keyboardOverlap(y + top, height, event.endCoordinates.screenY));
    });
  }, [top]);

  useEffect(() => {
    const shown = Keyboard.addListener('keyboardDidShow', (event) => {
      keyboard.current = event;
      measure();
    });
    const hidden = Keyboard.addListener('keyboardDidHide', () => {
      keyboard.current = null;
      measure();
    });
    return () => {
      shown.remove();
      hidden.remove();
    };
  }, [measure]);

  return (
    <View ref={ref} style={[styles.fill, { paddingBottom: bottom }]} onLayout={measure}>
      {children}
    </View>
  );
}

export const ScreenScrollView = forwardRef<ScrollView, ScrollViewProps>(
  function ScreenScrollView(props, ref) {
    return (
      <KeyboardClearance>
        <ScrollView ref={ref} {...screenListInsets} {...props} />
      </KeyboardClearance>
    );
  }
);

const styles = StyleSheet.create({
  // Grows and shrinks the way a scroll view does, so wrapping one changes no layout.
  fill: {
    flexGrow: 1,
    flexShrink: 1,
  },
});
