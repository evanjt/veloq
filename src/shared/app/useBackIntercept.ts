import { usePreventRemove } from 'expo-router/react-navigation';

// The actions a system back reaches the stack as: Android's back key and edge gesture dispatch
// a go-back, and a native header back pops.
const BACK_ACTIONS = new Set(['GO_BACK', 'POP']);

/**
 * Holds the system back control on a screen while `active`. Android's back key and edge gesture
 * are not governed by the screen's `gestureEnabled`, which only reaches the iOS swipe, so a
 * screen in a state back must not leave holds it here.
 *
 * While active, a back keeps the screen mounted and calls `onBack` with `carryOut`, which the
 * handler may call to carry the held back out after all. Any other navigation that would remove
 * the screen, such as returning to the root once a flow ends or a replace, is the app's own and
 * goes through. Both go through the hold's own release: an action dispatched again while the
 * screen is held is held again.
 */
export function useBackIntercept(active: boolean, onBack: (carryOut: () => void) => void): void {
  usePreventRemove(active, ({ data, repeat }) => {
    if (BACK_ACTIONS.has(data.action.type)) onBack(repeat);
    else repeat();
  });
}
