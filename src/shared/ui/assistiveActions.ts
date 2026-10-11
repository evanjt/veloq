/**
 * Named screen-reader actions on one accessible element.
 *
 * A press target nested inside a pressable is hidden inside the outer element
 * on iOS, and a hold or a swipe is announced by neither platform. Each is
 * offered on the outer element as a custom action instead, which VoiceOver
 * lists in its actions rotor and TalkBack in its actions menu. The action runs
 * the same handler the drawn control does, under the same label.
 */

import type { AccessibilityActionEvent, AccessibilityActionInfo } from 'react-native';

export interface AssistiveAction {
  /** The action's identifier, unique on the element. */
  name: string;
  /** What a screen reader announces, the drawn control's own label. */
  label: string;
  run: () => void;
}

export interface AssistiveActionProps {
  accessibilityActions?: AccessibilityActionInfo[];
  onAccessibilityAction?: (event: AccessibilityActionEvent) => void;
}

/**
 * The props that declare `actions` and dispatch each by name. An element with
 * no actions gets no props, so it declares no empty list.
 */
export function assistiveActions(actions: readonly AssistiveAction[]): AssistiveActionProps {
  if (actions.length === 0) return {};
  return {
    accessibilityActions: actions.map(({ name, label }) => ({ name, label })),
    onAccessibilityAction: (event) => {
      actions.find((action) => action.name === event.nativeEvent.actionName)?.run();
    },
  };
}
