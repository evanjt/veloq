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

import * as haptics from '@/shared/ui/haptics';
import { chooseAction, confirmAction, inform } from '@/shared/ui/dialog';

jest.mock('@/shared/ui/haptics', () => ({ medium: jest.fn() }));

type AlertCall = [string, string | undefined, AlertButton[] | undefined, AlertOptions | undefined];

function lastCall(): AlertCall {
  return (Alert.alert as jest.Mock).mock.calls.at(-1) as AlertCall;
}

const originalOs = Platform.OS;

beforeEach(() => {
  Platform.OS = 'android';
  jest.mocked(haptics.medium).mockClear();
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

/**
 * Scenario: a destructive action is accepted from a confirm or a choice. The
 * sections, the cache, the sign-outs and the discards all reach the athlete
 * through this module, so the medium impact that marks the act has to come
 * from here and not from each caller.
 *
 * Expected behaviour: an accepted destructive action fires one medium impact
 * before its handler runs. Cancel, a dismissal and a non-destructive action
 * fire none.
 */
describe('destructive accepts', () => {
  it('fires one medium impact before the confirm runs', () => {
    const onConfirm = jest.fn();
    confirmAction({
      title: 'Delete section?',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
      onConfirm,
    });

    lastCall()[2]?.at(-1)?.onPress?.();
    expect(haptics.medium).toHaveBeenCalledTimes(1);
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(jest.mocked(haptics.medium).mock.invocationCallOrder[0]).toBeLessThan(
      onConfirm.mock.invocationCallOrder[0]
    );
  });

  it('returns the handler result, so an awaited async confirm finishes first', async () => {
    let finished = false;
    const onConfirm = jest.fn(
      () =>
        new Promise<void>((resolve) =>
          setTimeout(() => {
            finished = true;
            resolve();
          }, 5)
        )
    );
    confirmAction({
      title: 'Clear cache?',
      confirmLabel: 'Clear',
      cancelLabel: 'Keep',
      destructive: true,
      onConfirm,
    });

    await lastCall()[2]?.at(-1)?.onPress?.();
    expect(finished).toBe(true);
  });

  it('fires nothing when the destructive confirm is cancelled or dismissed', () => {
    const onCancel = jest.fn();
    confirmAction({
      title: 'Delete section?',
      confirmLabel: 'Delete',
      cancelLabel: 'Keep',
      destructive: true,
      onConfirm: jest.fn(),
      onCancel,
    });

    lastCall()[2]?.[0]?.onPress?.();
    lastCall()[3]?.onDismiss?.();
    expect(onCancel).toHaveBeenCalledTimes(2);
    expect(haptics.medium).not.toHaveBeenCalled();
  });

  it('fires nothing for a confirm that is not destructive', () => {
    const onConfirm = jest.fn();
    confirmAction({ title: 'Rename?', confirmLabel: 'Rename', cancelLabel: 'Keep', onConfirm });

    lastCall()[2]?.at(-1)?.onPress?.();
    expect(onConfirm).toHaveBeenCalledTimes(1);
    expect(haptics.medium).not.toHaveBeenCalled();
  });

  it('fires one medium impact when a destructive choice is taken, and none for the others', () => {
    const onDelete = jest.fn();
    const onSettings = jest.fn();
    chooseAction({
      title: 'No GPS',
      cancelLabel: 'Carry on',
      actions: [
        { label: 'Stop', destructive: true, onPress: onDelete },
        { label: 'Settings', onPress: onSettings },
      ],
    });

    lastCall()[2]?.[2]?.onPress?.();
    expect(haptics.medium).not.toHaveBeenCalled();

    lastCall()[2]?.[0]?.onPress?.();
    expect(onDelete).toHaveBeenCalledTimes(1);
    expect(haptics.medium).toHaveBeenCalledTimes(1);
    expect(jest.mocked(haptics.medium).mock.invocationCallOrder[0]).toBeLessThan(
      onDelete.mock.invocationCallOrder[0]
    );
  });
});
