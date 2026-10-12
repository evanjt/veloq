/**
 * Scenario: on Android a dialog shown with no options ignores system back and a
 * scrim tap, and places buttons by position (last is positive) whatever their
 * style says.
 *
 * Expected behaviour: every dialog the module raises can be dismissed unless the
 * decision is marked required, a dismissal counts as the cancel, and the cancel
 * sits in the negative slot so a destructive action is never there by accident.
 */
import { Alert, Platform, type AlertButton, type AlertOptions } from 'react-native';

import { chooseAction, confirmAction, inform } from '@/shared/ui/dialog';

type AlertCall = [string, string | undefined, AlertButton[] | undefined, AlertOptions | undefined];

function lastCall(): AlertCall {
  return (Alert.alert as jest.Mock).mock.calls.at(-1) as AlertCall;
}

const originalOs = Platform.OS;

beforeEach(() => {
  Platform.OS = 'android';
  jest.spyOn(Alert, 'alert').mockImplementation(() => {});
});

afterEach(() => {
  Platform.OS = originalOs;
  jest.restoreAllMocks();
});

describe('confirmAction', () => {
  it('can be dismissed, and a dismissal is the cancel', () => {
    const onCancel = jest.fn();
    const onConfirm = jest.fn();
    confirmAction({
      title: 'Delete ride?',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
      onConfirm,
      onCancel,
    });

    const [, , , options] = lastCall();
    expect(options?.cancelable).toBe(true);
    options?.onDismiss?.();
    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('puts the cancel first, so Android shows the action as the positive button', () => {
    const onConfirm = jest.fn();
    confirmAction({
      title: 'Delete ride?',
      message: 'The ride goes from this device.',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
      onConfirm,
    });

    const [title, message, buttons] = lastCall();
    expect(title).toBe('Delete ride?');
    expect(message).toBe('The ride goes from this device.');
    expect(buttons?.map((b) => [b.text, b.style])).toEqual([
      ['Keep', 'cancel'],
      ['Delete', 'destructive'],
    ]);
    buttons?.at(-1)?.onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('dismisses without a cancel handler and calls nothing', () => {
    const onConfirm = jest.fn();
    confirmAction({ title: 'Rename?', confirmLabel: 'Rename', cancelLabel: 'Keep', onConfirm });

    const [, , buttons, options] = lastCall();
    expect(buttons?.at(-1)?.style).toBe('default');
    expect(options?.cancelable).toBe(true);
    expect(() => options?.onDismiss?.()).not.toThrow();
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('holds a required decision open against back and the scrim', () => {
    confirmAction({
      title: 'Whose library?',
      confirmLabel: 'Mine',
      cancelLabel: 'Back',
      onConfirm: jest.fn(),
      required: true,
    });

    const [, , , options] = lastCall();
    expect(options?.cancelable).toBe(false);
  });
});

describe('chooseAction', () => {
  it('puts the cancel in the negative slot and the last action in the positive one', () => {
    const onCancel = jest.fn();
    chooseAction({
      title: 'No GPS',
      cancelLabel: 'Carry on',
      onCancel,
      actions: [
        { label: 'Stop', destructive: true, onPress: jest.fn() },
        { label: 'Settings', onPress: jest.fn() },
      ],
    });

    const [, , buttons, options] = lastCall();
    expect(buttons?.map((b) => [b.text, b.style])).toEqual([
      ['Stop', 'destructive'],
      ['Carry on', 'cancel'],
      ['Settings', 'default'],
    ]);
    expect(options?.cancelable).toBe(true);
    options?.onDismiss?.();
    expect(onCancel).toHaveBeenCalledTimes(1);
  });

  it('can be dismissed with no cancel button at all', () => {
    const onDismiss = jest.fn();
    chooseAction({
      title: 'Resume ride?',
      onCancel: onDismiss,
      actions: [
        { label: 'Discard', destructive: true, onPress: jest.fn() },
        { label: 'Resume', onPress: jest.fn() },
      ],
    });

    const [, , buttons, options] = lastCall();
    expect(buttons?.map((b) => b.text)).toEqual(['Discard', 'Resume']);
    expect(options?.cancelable).toBe(true);
    options?.onDismiss?.();
    expect(onDismiss).toHaveBeenCalledTimes(1);
  });

  it('holds a required choice open', () => {
    chooseAction({
      title: 'Whose library?',
      cancelLabel: 'Back',
      required: true,
      actions: [{ label: 'Mine', onPress: jest.fn() }],
    });

    expect(lastCall()[3]?.cancelable).toBe(false);
  });
});

describe('inform', () => {
  it('can be dismissed', () => {
    inform({ title: 'Backup not restored', message: 'The file is damaged.' });

    const [title, message, buttons, options] = lastCall();
    expect(title).toBe('Backup not restored');
    expect(message).toBe('The file is damaged.');
    expect(buttons).toBeUndefined();
    expect(options?.cancelable).toBe(true);
  });

  it('runs the same handler for its button and for a dismissal', () => {
    const onDismiss = jest.fn();
    inform({ title: 'Library rebuilt', dismissLabel: 'Got it', onDismiss });

    const [, , buttons, options] = lastCall();
    expect(buttons?.map((b) => b.text)).toEqual(['Got it']);
    buttons?.[0].onPress?.();
    options?.onDismiss?.();
    expect(onDismiss).toHaveBeenCalledTimes(2);
  });
});
