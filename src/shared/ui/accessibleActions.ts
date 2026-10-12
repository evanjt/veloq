/**
 * What a hold, a swipe or a nested press offers a screen reader.
 *
 * VoiceOver, TalkBack, Switch Control and Full Keyboard Access list a view's
 * custom actions only when the view declares them, and both screen readers
 * take a swipe for themselves. So every gesture that runs a real action names
 * it here, with the label of its visible button and the same handler.
 */

import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native';

export interface AccessibleAction {
  /** The name the platform dispatches by. `longpress` is the platform's own hold. */
  name: string;
  /** What the action list reads, the same string the visible control shows. */
  label: string;
  run: () => void;
}

export interface AccessibleActionProps {
  accessibilityActions: AccessibilityActionInfo[] | undefined;
  onAccessibilityAction: ((event: AccessibilityActionEvent) => void) | undefined;
}

const NONE: AccessibleActionProps = {
  accessibilityActions: undefined,
  onAccessibilityAction: undefined,
};

/** The pair a view spreads, dispatching each action by name. No actions declares nothing. */
export function accessibleActions(
  actions: readonly AccessibleAction[] | undefined
): AccessibleActionProps {
  if (!actions || actions.length === 0) return NONE;
  return {
    accessibilityActions: actions.map(({ name, label }) => ({ name, label })),
    onAccessibilityAction: (event) => {
      actions.find((action) => action.name === event.nativeEvent.actionName)?.run();
    },
  };
}
