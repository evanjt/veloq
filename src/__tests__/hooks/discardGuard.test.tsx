/**
 * Scenario: a screen holds typed input nothing has saved, and the athlete goes
 * back through the header, the iOS edge swipe or Android back.
 *
 * Expected behaviour: while something would be lost the screen stays and asks,
 * with Keep editing and a destructive Discard. Keep editing leaves the input
 * as it was, Discard carries out the back that was held. With nothing to lose,
 * back leaves at once and asks nothing.
 */
import { useState } from 'react';
import { Alert, Text, TextInput, type AlertButton } from 'react-native';
import { act, fireEvent, render } from '@testing-library/react-native';

import { useDiscardGuard } from '@/shared/app/useDiscardGuard';
import { ManualEntryForm } from '@/features/recording/components/ManualEntryForm';
import { StrengthSession } from '@/features/recording/components/StrengthFollow';
import { useRecordingStore } from '@/features/recording/stores/RecordingStore';
import { StackActions } from 'expo-router/react-navigation';
import { testStack } from '../__shared__/testStack';

jest.unmock('expo-router/react-navigation');
jest.mock('react-i18next', () => require('../__shared__/i18nMock').keysOnly());
jest.mock('@/shared/app', () => ({ useTheme: () => ({ isDark: false }) }));
jest.mock('@/shared/app/navigation', () => ({ navigateTo: jest.fn(), tapBack: jest.fn() }));
jest.mock('@/features/recording/hooks/useRecordingKeepAwake', () => ({
  useRecordingKeepAwake: () => undefined,
}));
jest.mock('@/features/recording/lib/plannedWorkout', () => ({
  readPlannedWorkout: () => ({
    name: 'Kettlebell circuit',
    lines: [
      { kind: 'work', text: 'Swings x20', durationSeconds: null },
      { kind: 'work', text: 'Goblet squats x12', durationSeconds: null },
    ],
  }),
}));

let alertSpy: jest.SpyInstance;

beforeEach(() => {
  alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  useRecordingStore.getState().reset();
});

afterEach(() => {
  alertSpy.mockRestore();
});

function Root() {
  return <Text>root</Text>;
}

function lastButtons(): AlertButton[] {
  const call = alertSpy.mock.calls[alertSpy.mock.calls.length - 1];
  return (call?.[2] ?? []) as AlertButton[];
}

async function press(label: string) {
  const button = lastButtons().find((b) => b.text === label);
  if (!button) throw new Error(`no ${label} button`);
  await act(() => button.onPress?.());
}

function routeName(ref: ReturnType<typeof testStack>['ref']) {
  return ref.current?.getCurrentRoute()?.name;
}

function Draft({ dirty }: { dirty: boolean }) {
  const [text, setText] = useState('');
  useDiscardGuard(dirty);
  return <TextInput testID="draft" value={text} onChangeText={setText} />;
}

async function mountAndOpen(screen: () => React.JSX.Element) {
  const stack = testStack({ root: Root, form: screen });
  const view = await render(stack.element);
  await act(() => stack.ref.current?.navigate('form'));
  return { view, ref: stack.ref };
}

describe('useDiscardGuard', () => {
  it('holds back and asks while something would be lost', async () => {
    const { view, ref } = await mountAndOpen(() => <Draft dirty />);
    await fireEvent.changeText(view.getByTestId('draft'), 'tempo blocks');

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('form');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    expect(alertSpy.mock.calls[0]?.[0]).toBe('common.discardChangesTitle');
    const buttons = lastButtons();
    expect(buttons.map((b) => [b.text, b.style])).toEqual([
      ['common.keepEditing', 'cancel'],
      ['common.discard', 'destructive'],
    ]);
  });

  it('keeps the input when the athlete keeps editing', async () => {
    const { view, ref } = await mountAndOpen(() => <Draft dirty />);
    await fireEvent.changeText(view.getByTestId('draft'), 'tempo blocks');
    await act(() => ref.current?.goBack());

    await press('common.keepEditing');

    expect(routeName(ref)).toBe('form');
    expect(view.getByTestId('draft').props.value).toBe('tempo blocks');
  });

  it('carries out the held back when the athlete discards', async () => {
    const { view, ref } = await mountAndOpen(() => <Draft dirty />);
    await act(() => ref.current?.goBack());

    await press('common.discard');

    expect(routeName(ref)).toBe('root');
    expect(view.queryByTestId('draft')).toBeNull();
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('asks again on a second back after keeping the input', async () => {
    const { ref } = await mountAndOpen(() => <Draft dirty />);
    await act(() => ref.current?.goBack());
    await press('common.keepEditing');

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('form');
    expect(alertSpy).toHaveBeenCalledTimes(2);
  });

  it('leaves at once with nothing to lose', async () => {
    const { ref } = await mountAndOpen(() => <Draft dirty={false} />);

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('lets the flow ending at the root through, beneath the screen it handed on to', async () => {
    const stack = testStack({ root: Root, form: () => <Draft dirty />, next: Root });
    await render(stack.element);
    await act(() => stack.ref.current?.navigate('form'));
    await act(() => stack.ref.current?.navigate('next'));

    await act(() => stack.ref.current?.dispatch(StackActions.popTo('root')));

    expect(routeName(stack.ref)).toBe('root');
    expect(stack.ref.current?.getRootState().routes.map((r) => r.name)).toEqual(['root']);
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('lets a replace of the screen itself through', async () => {
    const { ref } = await mountAndOpen(() => <Draft dirty />);

    await act(() => ref.current?.dispatch(StackActions.replace('root')));

    expect(routeName(ref)).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('holds a pop as it holds a go-back', async () => {
    const { ref } = await mountAndOpen(() => <Draft dirty />);

    await act(() => ref.current?.dispatch(StackActions.pop()));

    expect(routeName(ref)).toBe('form');
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the manual entry form', () => {
  function Form() {
    return <ManualEntryForm activityType="Yoga" bottomPadding={0} />;
  }

  it('asks before back drops typed notes, and keeps them on Keep editing', async () => {
    const { view, ref } = await mountAndOpen(Form);
    await fireEvent.changeText(view.getByTestId('manual-entry-notes'), 'Hip openers, slow flow');

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('form');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    await press('common.keepEditing');
    expect(view.getByTestId('manual-entry-notes').props.value).toBe('Hip openers, slow flow');

    await act(() => ref.current?.goBack());
    await press('common.discard');
    expect(routeName(ref)).toBe('root');
  });

  it('stays quiet beneath the review when a save returns to the root', async () => {
    const stack = testStack({ root: Root, form: Form, review: Root });
    const view = await render(stack.element);
    await act(() => stack.ref.current?.navigate('form'));
    await fireEvent.changeText(view.getByTestId('manual-entry-notes'), 'Hip openers, slow flow');
    await act(() => stack.ref.current?.navigate('review'));

    await act(() => stack.ref.current?.dispatch(StackActions.popTo('root')));

    expect(routeName(stack.ref)).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('leaves untouched with no prompt', async () => {
    const { ref } = await mountAndOpen(Form);

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('counts a prefill as nothing to lose until a field moves off it', async () => {
    function Prefilled() {
      return (
        <ManualEntryForm
          activityType="WeightTraining"
          bottomPadding={0}
          prefill={{ name: 'Leg day', durationMinutes: '45', notes: 'Squat 5x5' }}
        />
      );
    }
    const { view, ref } = await mountAndOpen(Prefilled);
    await fireEvent.changeText(view.getByTestId('manual-entry-hr'), '128');
    await fireEvent.changeText(view.getByTestId('manual-entry-hr'), '');

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('root');
    expect(alertSpy).not.toHaveBeenCalled();
  });

  it('asks when a prefilled field is edited', async () => {
    function Prefilled() {
      return (
        <ManualEntryForm
          activityType="WeightTraining"
          bottomPadding={0}
          prefill={{ name: 'Leg day', durationMinutes: '45' }}
        />
      );
    }
    const { view, ref } = await mountAndOpen(Prefilled);
    await fireEvent.changeText(view.getByTestId('manual-entry-duration'), '50');

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('form');
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });

  it('asks before back drops input it was opened with, even untouched', async () => {
    function Finished() {
      return (
        <ManualEntryForm
          activityType="WeightTraining"
          bottomPadding={0}
          prefill={{ name: 'Leg day', durationMinutes: '45' }}
          unsaved
        />
      );
    }
    const { ref } = await mountAndOpen(Finished);

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('form');
    expect(alertSpy).toHaveBeenCalledTimes(1);
  });
});

describe('the guided strength session', () => {
  function Session() {
    return <StrengthSession activityType="WeightTraining" pairedEventId={41} />;
  }

  it('asks before back ends a session under way, and keeps its progress on Keep editing', async () => {
    const { view, ref } = await mountAndOpen(Session);
    await fireEvent.press(view.getByTestId('strength-tick'));
    expect(view.getByTestId('strength-current-line')).toHaveTextContent('Goblet squats x12');

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('form');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    await press('common.keepEditing');
    expect(view.getByTestId('strength-current-line')).toHaveTextContent('Goblet squats x12');
  });

  it('asks before back drops a finished session that is not yet saved', async () => {
    const { view, ref } = await mountAndOpen(Session);
    await fireEvent.press(view.getByTestId('strength-tick'));
    await fireEvent.press(view.getByTestId('strength-tick'));
    expect(view.getByTestId('manual-entry-continue')).toBeTruthy();

    await act(() => ref.current?.goBack());

    expect(routeName(ref)).toBe('form');
    expect(alertSpy).toHaveBeenCalledTimes(1);
    await press('common.discard');
    expect(routeName(ref)).toBe('root');
  });
});
