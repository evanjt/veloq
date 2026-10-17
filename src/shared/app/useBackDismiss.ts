/**
 * Back ends a transient state before it navigates: an open menu, a popup, a
 * selection list, an edit mode. While `active`, the platform back routes to
 * `onDismiss` instead of leaving the screen.
 *
 * Android's hardware back and back gesture reach a `BackHandler` listener,
 * which runs before the navigator's own. That covers a tab root too, where
 * back switches tab rather than removing a screen. The listener answers only
 * while its screen is focused, so a menu left open on a tab the athlete has
 * moved away from does not swallow back on the tab in front.
 *
 * On a stack screen the removal itself is held as well, which is the iOS
 * header back, the edge swipe and any `goBack`, and the swipe and the header
 * back control are turned off while the state lasts, so the state's own
 * Cancel is the way out.
 *
 * The navigator is read from context rather than through `useNavigation`, so a
 * component rendered outside any navigator still gets the hardware back.
 */

import { use, useEffect, useRef, useState } from 'react';
import { BackHandler } from 'react-native';
import {
  NavigationContext,
  NavigationRouteContext,
  usePreventRemove,
} from 'expo-router/react-navigation';

/** Outside a screen there is no removal to hold. */
function useNoHold(_prevent: boolean, _onPrevented: () => void): void {}

let nextId = 0;
/** The states holding each stack route, so its swipe returns only when the last one ends. */
const holders = new Map<string, Set<string>>();

export function useBackDismiss(active: boolean, onDismiss: () => void): void {
  const navigation = use(NavigationContext);
  const route = use(NavigationRouteContext);
  const [id] = useState(() => `back-dismiss-${++nextId}`);

  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useEffect(() => {
    if (!active) return undefined;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      if (navigation && !navigation.isFocused()) return false;
      dismissRef.current();
      return true;
    });
    return () => subscription.remove();
  }, [active, navigation]);

  // A navigator's state no longer names its kind; a stack is the navigator that pushes.
  const onStack = navigation !== undefined && 'push' in navigation;
  const routeKey = route?.key;
  const holding = active && onStack && !!navigation && !!routeKey;

  // A component sits inside a screen or outside every screen for its whole life, so the
  // hook taken here is the same one on every render. Every holder hears the held removal
  // and only the one opened last ends, as on Android.
  const useHoldRemoval = navigation && route ? usePreventRemove : useNoHold;
  useHoldRemoval(holding, () => {
    if (routeKey && [...(holders.get(routeKey) ?? [])].at(-1) === id) dismissRef.current();
  });

  useEffect(() => {
    if (!holding || !navigation || !routeKey) return undefined;
    const held = holders.get(routeKey) ?? new Set<string>();
    holders.set(routeKey, held);
    if (held.size === 0) {
      navigation.setOptions({ gestureEnabled: false, headerBackVisible: false });
    }
    held.add(id);
    return () => {
      held.delete(id);
      if (held.size > 0) return;
      holders.delete(routeKey);
      navigation.setOptions({ gestureEnabled: true, headerBackVisible: true });
    };
  }, [holding, navigation, routeKey, id]);
}
