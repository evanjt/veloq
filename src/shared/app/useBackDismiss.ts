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
 * On a stack screen the removal itself is held as well, so the iOS header
 * back, the edge swipe, a sheet's drag and any `goBack` end the state as
 * Android's back does. The native stack refuses the swipe and the drag while
 * removal is held, and the screen's own options are left as it set them: a
 * sheet whose dismiss gesture is off keeps it off.
 *
 * A sheet whose dismiss gesture is off still has its drag past the lowest stop refused natively,
 * and the stack reports the refusal as a pop sourced from the route. Under `NativeDismissRefused`
 * that pop is not a back: the held state is left as it is, while the host's own go-back and
 * Android's back still end it.
 *
 * The navigator is read from context rather than through `useNavigation`, so a
 * component rendered outside any navigator still gets the hardware back.
 */

import {
  createContext,
  createElement,
  use,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { BackHandler } from 'react-native';
import {
  NavigationContext,
  NavigationRouteContext,
  usePreventRemove,
} from 'expo-router/react-navigation';

/** Outside a screen there is no removal to hold. */
function useNoHold(_prevent: boolean, _onPrevented: () => void): void {}

const NativeDismissRefusedContext = createContext(false);

/** Marks the screens below as sheets whose drag-to-dismiss the native stack refuses. */
export function NativeDismissRefused({ value, children }: { value: boolean; children: ReactNode }) {
  return createElement(NativeDismissRefusedContext, { value }, children);
}

let nextId = 0;
/** The states holding each stack route, so a held removal ends the newest one. */
const holders = new Map<string, Set<string>>();

/**
 * Android's back alone, for a state that closes itself when its screen goes, such as a menu:
 * it has nothing to hold the screen for, and leaves the screen's swipe and header back as the
 * screen set them.
 */
export function useHardwareBackDismiss(active: boolean, onDismiss: () => void): void {
  const navigation = use(NavigationContext);

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
}

export function useBackDismiss(active: boolean, onDismiss: () => void): void {
  const navigation = use(NavigationContext);
  const route = use(NavigationRouteContext);
  const [id] = useState(() => `back-dismiss-${++nextId}`);
  const dismissRefused = use(NativeDismissRefusedContext);

  const dismissRef = useRef(onDismiss);
  useEffect(() => {
    dismissRef.current = onDismiss;
  }, [onDismiss]);

  useHardwareBackDismiss(active, onDismiss);

  // A navigator's state no longer names its kind; a stack is the navigator that pushes.
  const onStack = navigation !== undefined && 'push' in navigation;
  const routeKey = route?.key;
  const holding = active && onStack && !!navigation && !!routeKey;

  // A component sits inside a screen or outside every screen for its whole life, so the
  // hook taken here is the same one on every render. Every holder hears the held removal
  // and only the one opened last ends, as on Android.
  const useHoldRemoval = navigation && route ? usePreventRemove : useNoHold;
  useHoldRemoval(holding, (event?: { data: { action: { type: string; source?: string } } }) => {
    const action = event?.data.action;
    if (dismissRefused && action?.type === 'POP' && action.source === routeKey) return;
    if (routeKey && [...(holders.get(routeKey) ?? [])].at(-1) === id) dismissRef.current();
  });

  useEffect(() => {
    if (!holding || !navigation || !routeKey) return undefined;
    const held = holders.get(routeKey) ?? new Set<string>();
    holders.set(routeKey, held);
    held.add(id);
    return () => {
      held.delete(id);
      if (held.size === 0) holders.delete(routeKey);
    };
  }, [holding, navigation, routeKey, id]);
}
