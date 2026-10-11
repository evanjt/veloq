/**
 * Scenario: a control nested inside a pressable, or reached only by a hold or
 * a swipe, is offered to a screen reader as a named action on the outer
 * element.
 *
 * Expected behaviour: each named action runs its own handler and nothing else,
 * a name the element did not declare runs nothing, and an element with no
 * actions declares none rather than an empty list.
 */

import type { AccessibilityActionEvent } from 'react-native';

import { assistiveActions } from '@/shared/ui/assistiveActions';

function fire(handler: ((event: AccessibilityActionEvent) => void) | undefined, name: string) {
  handler?.({ nativeEvent: { actionName: name } } as AccessibilityActionEvent);
}

describe('assistiveActions', () => {
  it('declares each action by name and label', () => {
    const props = assistiveActions([
      { name: 'archive', label: 'Archive', run: jest.fn() },
      { name: 'pin', label: 'Pin', run: jest.fn() },
    ]);

    expect(props.accessibilityActions).toEqual([
      { name: 'archive', label: 'Archive' },
      { name: 'pin', label: 'Pin' },
    ]);
  });

  it('runs the handler of the named action only', () => {
    const archive = jest.fn();
    const pin = jest.fn();
    const props = assistiveActions([
      { name: 'archive', label: 'Archive', run: archive },
      { name: 'pin', label: 'Pin', run: pin },
    ]);

    fire(props.onAccessibilityAction, 'pin');

    expect(pin).toHaveBeenCalledTimes(1);
    expect(archive).not.toHaveBeenCalled();
  });

  it('runs nothing for a name it did not declare', () => {
    const archive = jest.fn();
    const props = assistiveActions([{ name: 'archive', label: 'Archive', run: archive }]);

    fire(props.onAccessibilityAction, 'activate');

    expect(archive).not.toHaveBeenCalled();
  });

  it('runs the handler again on a second action', () => {
    const archive = jest.fn();
    const props = assistiveActions([{ name: 'archive', label: 'Archive', run: archive }]);

    fire(props.onAccessibilityAction, 'archive');
    fire(props.onAccessibilityAction, 'archive');

    expect(archive).toHaveBeenCalledTimes(2);
  });

  it('declares nothing when there are no actions', () => {
    expect(assistiveActions([])).toEqual({});
  });
});
