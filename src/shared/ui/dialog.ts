/**
 * The one caller of `Alert.alert`. On Android a dialog raised without options
 * ignores system back and a scrim tap, and its buttons are placed by position
 * (the last is the positive one) whatever their style says. Every dialog here
 * can be dismissed unless the decision is `required`, a dismissal counts as the
 * cancel, and the cancel sits in the negative slot.
 *
 * `scripts/run-guards.mjs` refuses `Alert.alert` anywhere else, and a bare
 * "Error" as the title of a failure notice.
 */

import { Alert, type AlertButton, type AlertOptions } from 'react-native';

function dismissal(required: boolean | undefined, onDismiss?: () => void): AlertOptions {
  if (required) return { cancelable: false };
  return { cancelable: true, onDismiss };
}

export interface ConfirmActionArgs {
  title: string;
  message?: string;
  /** Names the action, never a generic word. */
  confirmLabel: string;
  cancelLabel: string;
  destructive?: boolean;
  onConfirm: () => void;
  /** Runs on Cancel and on a dismissal by back or a scrim tap. */
  onCancel?: () => void;
  /** A decision the app cannot go on without: back and the scrim do nothing. */
  required?: boolean;
}

/** Ask before one action. Cancel goes first so Android shows the action as positive. */
export function confirmAction(args: ConfirmActionArgs): void {
  Alert.alert(
    args.title,
    args.message,
    [
      { text: args.cancelLabel, style: 'cancel', onPress: args.onCancel },
      {
        text: args.confirmLabel,
        style: args.destructive ? 'destructive' : 'default',
        onPress: args.onConfirm,
      },
    ],
    dismissal(args.required, args.onCancel)
  );
}

export interface ChoiceAction {
  label: string;
  destructive?: boolean;
  onPress: () => void;
}

export interface ChooseActionArgs {
  title: string;
  message?: string;
  /** One or two actions, the primary last: Android shows the last as positive. */
  actions: [ChoiceAction] | [ChoiceAction, ChoiceAction];
  /** A Cancel button, placed just before the primary so Android shows it as negative. */
  cancelLabel?: string;
  /** Runs on Cancel and on a dismissal by back or a scrim tap. */
  onCancel?: () => void;
  required?: boolean;
}

/** Ask between two actions, or one with a way back that is not Cancel's alone. */
export function chooseAction(args: ChooseActionArgs): void {
  const buttons: AlertButton[] = args.actions.map((action) => ({
    text: action.label,
    style: action.destructive ? 'destructive' : 'default',
    onPress: action.onPress,
  }));
  if (args.cancelLabel !== undefined) {
    buttons.splice(buttons.length - 1, 0, {
      text: args.cancelLabel,
      style: 'cancel',
      onPress: args.onCancel,
    });
  }
  Alert.alert(args.title, args.message, buttons, dismissal(args.required, args.onCancel));
}

export type InformArgs = {
  /** Names what happened: a failure is "Backup not restored", never a bare "Error". */
  title: string;
  message?: string;
} & (
  | { dismissLabel?: undefined; onDismiss?: undefined }
  /** A handler needs its own button, since the platform's default one calls nothing. */
  | { dismissLabel: string; onDismiss?: () => void }
);

/** A notice with one way out, which back and a scrim tap take too. */
export function inform(args: InformArgs): void {
  const buttons: AlertButton[] | undefined =
    args.dismissLabel === undefined
      ? undefined
      : [{ text: args.dismissLabel, onPress: args.onDismiss }];
  Alert.alert(args.title, args.message, buttons, dismissal(false, args.onDismiss));
}
