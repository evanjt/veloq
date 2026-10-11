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
  PreventRemoveContext,
} from 'expo-router/react-navigation';

let nextId = 0;
/** The states holding each stack route, so its swipe returns only when the last one ends. */
const holders = new Map<string, Set<string>>();

export function useBackDismiss(active: boolean, onDismiss: () => void): void {
  const navigation = use(NavigationContext);
  const route = use(NavigationRouteContext);
  const preventRemove = use(PreventRemoveContext);
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

  const onStack = navigation?.getState?.()?.type === 'stack';
  const routeKey = route?.key;
  const setPreventRemove = preventRemove?.setPreventRemove;

  useEffect(() => {
    if (!active || !onStack || !navigation || !routeKey || !setPreventRemove) return undefined;
    setPreventRemove(id, routeKey, true);
    const held = holders.get(routeKey) ?? new Set<string>();
    holders.set(routeKey, held);
    // Every holder hears the removal and only the one opened last ends, as on Android.
    const removeListener = navigation.addListener('beforeRemove', (event) => {
      event.preventDefault();
      if ([...held].at(-1) === id) dismissRef.current();
    });
    if (held.size === 0) {
      navigation.setOptions({ gestureEnabled: false, headerBackVisible: false });
    }
    held.add(id);
    return () => {
      setPreventRemove(id, routeKey, false);
      removeListener();
      held.delete(id);
      if (held.size > 0) return;
      holders.delete(routeKey);
      navigation.setOptions({ gestureEnabled: true, headerBackVisible: true });
    };
  }, [active, onStack, navigation, routeKey, setPreventRemove, id]);
}
