/**
 * Scenario: an athlete builds a strength workout in the linked browser: adds
 * exercises from the picker, edits their sets, copies sets from another
 * session and saves.
 *
 * Expected behaviour: the picker lists the rows the engine's read answered, in
 * its order; an added exercise carries the sets the engine gave for its last
 * time; saving sends the draft as the one write the link allows for it; the
 * address names the workout being edited.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { parse, tabOf, write } from '../../../web/connect/router';
import { fakePhone } from '../__shared__/connectPhone';
import { Button, ToastProvider } from '../../../web/connect/ui';
import { WorkoutsPage } from '../../../web/connect/pages/WorkoutsPage';
import {
  blankDraft,
  canSave,
  editedSet,
  fromGroup,
  movedExercise,
  openingPicker,
  pickerAsk,
  restoreAsk,
  saveAsk,
  setsOfSame,
  toggledEquipment,
  typedNumber,
  withExercise,
  withoutExercise,
  withoutSet,
  withSet,
  withSetsFrom,
  type DraftSet,
} from '../../../web/connect/workoutBuilder';

const SET = (reps: number, weightKg: number): DraftSet => ({
  reps,
  weightKg,
  durationSecs: null,
  side: null,
  warmUp: false,
});

describe('restoring a deleted workout', () => {
  it('asks for the workout back under its id, with its content and the times its row had', () => {
    const row = {
      id: 'saved-3',
      name: 'Pull',
      exerciseCount: 1,
      setCount: 1,
      lastUsedAt: 1_800_000_500,
      createdAt: 1_800_000_000,
    };
    const exercises = [{ category: 0, name: 1, groupNo: null, restSecs: null, sets: [SET(8, 60)] }];
    expect(
      restoreAsk(row, {
        id: 'saved-3',
        name: 'Pull',
        exercises,
        groups: [{ groupNo: 1, restSecs: 90 }],
      })
    ).toEqual({
      id: 'saved-3',
      name: 'Pull',
      exercises,
      groups: [{ groupNo: 1, restSecs: 90 }],
      createdAt: 1_800_000_000,
      lastUsedAt: 1_800_000_500,
    });
  });
});

describe('the draft', () => {
  it('adds an exercise with the sets the engine gave, or one blank set', () => {
    const given = withExercise(blankDraft(), 0, 1, [SET(8, 40), SET(6, 45)]);
    expect(given.exercises[0].sets).toEqual([SET(8, 40), SET(6, 45)]);
    const fresh = withExercise(blankDraft(), 7, null, []);
    expect(fresh.exercises[0].sets).toHaveLength(1);
    expect(fresh.exercises[0].sets[0].reps).toBeNull();
  });

  it('adds a set as a copy of the last, and keeps the last set when removing', () => {
    const one = withExercise(blankDraft(), 0, 1, [SET(8, 40)]);
    const two = withSet(one, 0);
    expect(two.exercises[0].sets).toEqual([SET(8, 40), SET(8, 40)]);
    expect(withoutSet(withoutSet(two, 0, 1), 0, 0).exercises[0].sets).toEqual([SET(8, 40)]);
  });

  it('edits one value of one set and leaves the others', () => {
    const draft = withExercise(blankDraft(), 0, 1, [SET(8, 40), SET(8, 40)]);
    const edited = editedSet(draft, 0, 1, 'weightKg', 42.5);
    expect(edited.exercises[0].sets.map((set) => set.weightKg)).toEqual([40, 42.5]);
    expect(editedSet(draft, 3, 0, 'reps', 1)).toBe(draft);
  });

  it('moves an exercise by one place and not past either end', () => {
    const draft = withExercise(withExercise(blankDraft(), 0, 1, []), 7, 2, []);
    expect(movedExercise(draft, 1, -1).exercises.map((e) => e.category)).toEqual([7, 0]);
    expect(movedExercise(draft, 0, -1)).toBe(draft);
    expect(movedExercise(draft, 1, 1)).toBe(draft);
  });

  it('drops a group once the exercises in it are removed', () => {
    const base = withExercise(blankDraft(), 0, 1, []);
    const grouped = {
      ...base,
      exercises: [{ ...base.exercises[0], groupNo: 1 }],
      groups: [{ groupNo: 1, restSecs: 90 }],
    };
    expect(withoutExercise(grouped, 0).groups).toEqual([]);
  });

  it('copies sets from the same exercise of another session, and nothing for a different one', () => {
    const draft = withExercise(blankDraft(), 0, 1, [SET(5, 20)]);
    const source = [
      { category: 7, name: null, groupNo: null, restSecs: null, sets: [SET(10, 10)] },
      { category: 0, name: 1, groupNo: null, restSecs: null, sets: [SET(8, 60), SET(8, 60)] },
    ];
    const copied = setsOfSame(source, draft.exercises[0]);
    expect(withSetsFrom(draft, 0, copied).exercises[0].sets).toEqual([SET(8, 60), SET(8, 60)]);
    expect(setsOfSame(source, { ...draft.exercises[0], name: 9 })).toEqual([]);
    expect(withSetsFrom(draft, 0, [])).toBe(draft);
  });

  it('starts from a recent group with the sets read for it', () => {
    const draft = fromGroup({
      signature: '0.1',
      times: 3,
      lastDone: 1,
      latestActivityId: 'a1',
      muscles: [],
      equipment: [],
      exercises: [{ category: 0, name: 1, groupNo: null, restSecs: null, sets: [SET(8, 60)] }],
    });
    expect(draft.id).toBeNull();
    expect(draft.exercises[0].sets).toEqual([SET(8, 60)]);
  });

  it('saves only with a name and an exercise, and sends the name trimmed', () => {
    const draft = withExercise(blankDraft(), 0, 1, []);
    expect(canSave(draft)).toBe(false);
    expect(canSave({ ...blankDraft(), name: 'Push' })).toBe(false);
    const named = { ...draft, name: '  Push ' };
    expect(canSave(named)).toBe(true);
    expect(saveAsk(named).name).toBe('Push');
    expect(saveAsk({ ...named, id: 'saved-1' }).id).toBe('saved-1');
  });

  it('reads a typed number: empty clears, a bad one is refused', () => {
    expect(typedNumber('')).toBeNull();
    expect(typedNumber('42.5')).toBe(42.5);
    expect(typedNumber('-1')).toBeUndefined();
    expect(typedNumber('abc')).toBeUndefined();
  });
});

describe('the picker ask', () => {
  it('names the filters, the query and the exercise the draft ends with', () => {
    const draft = withExercise(blankDraft(), 0, 1, []);
    const picker = toggledEquipment({ ...openingPicker(), query: 'press' }, 'barbell');
    expect(pickerAsk(picker, draft, 100)).toEqual({
      equipment: ['barbell'],
      region: null,
      muscle: null,
      query: 'press',
      afterCategory: 0,
      afterName: 1,
      nowWallSeconds: 100,
    });
    expect(toggledEquipment(picker, 'barbell').equipment).toEqual([]);
    expect(pickerAsk(openingPicker(), blankDraft(), 1).afterCategory).toBeNull();
  });
});

describe('the address', () => {
  it('names a new workout and an edited one, both under the insights tab', () => {
    expect(parse(write({ screen: 'workouts', id: null, query: [] }))).toEqual({
      screen: 'workouts',
      id: null,
      query: [],
    });
    expect(parse('#/workout/saved-1')).toEqual({ screen: 'workout', id: 'saved-1', query: [] });
    expect(tabOf(parse('#/workout/saved-1'))).toBe('insights');
    expect(tabOf(parse('#/workouts'))).toBe('insights');
    expect(parse('#/workout').screen).toBe('activities');
  });
});

const ROWS = [
  {
    category: 0,
    name: 1,
    labelKey: 'a',
    displayName: 'Bench press',
    equipment: 'barbell',
    lastDoneDays: 3,
    usuallyNext: false,
  },
  {
    category: 0,
    name: 2,
    labelKey: 'b',
    displayName: 'Incline press',
    equipment: 'dumbbell',
    lastDoneDays: null,
    usuallyNext: false,
  },
];

function fakeSession() {
  return fakePhone((method: string, params: unknown) => {
    if (method === 'strength.picker') {
      const asked = params as { query: string };
      return {
        rows: asked.query === 'zzz' ? [] : ROWS,
        equipment: ['barbell', 'dumbbell'],
        muscles: [],
      };
    }
    if (method === 'strength.workouts') return { workouts: [] };
    if (method === 'strength.groups') return { groups: [] };
    if (method === 'strength.lastTime') {
      return { lastTime: { daysAgo: 3, sets: [SET(8, 60), SET(8, 60)] } };
    }
    if (method === 'strength.saveWorkout') return { id: 'saved-9' };
    throw new Error(`unexpected read ${method}`);
  });
}

async function settle() {
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const pickerRows = (root: ReactTestRenderer) =>
  root.root.findAll(
    (node) =>
      node.type === 'tr' &&
      typeof node.props.id === 'string' &&
      node.props.id.startsWith('workout-picker-row-')
  );

const buttonsOf = (root: ReactTestRenderer) => root.root.findAllByType(Button);

describe('the builder page', () => {
  it('lists the picker rows as the engine answered them, with how long ago each was done', async () => {
    const phone = fakeSession();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        phone.wrap(<WorkoutsPage route={{ screen: 'workouts', id: null, query: [] }} />)
      );
    });
    await settle();
    const names = pickerRows(root).map((row) => row.findAllByType('td')[0].props.children);
    expect(names).toEqual(['Bench press', 'Incline press']);
    root.unmount();
  });

  it('adds an exercise with its last-time sets and saves the draft through the write', async () => {
    const phone = fakeSession();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        phone.wrap(<WorkoutsPage route={{ screen: 'workouts', id: null, query: [] }} />)
      );
    });
    await settle();
    await act(async () => {
      pickerRows(root)[0].props.onClick({});
    });
    await settle();
    expect(phone.callsOf('strength.lastTime')).toEqual([
      {
        method: 'strength.lastTime',
        params: { category: 0, name: 1, nowWallSeconds: expect.any(Number) },
      },
    ]);
    const sets = root.root
      .findByProps({ id: 'workout-exercises' })
      .findAllByType('tr')
      .filter((row) => row.findAllByType('td').length > 1);
    expect(sets).toHaveLength(2);

    await act(async () => {
      root.root
        .findAll((node) => node.type === 'input' && node.props.id === 'workout-name')[0]
        .props.onChange({ currentTarget: { value: 'Push' } });
    });
    const save = buttonsOf(root).find(
      (button) => button.props.children === 'connectPage.workouts.save'
    );
    expect(save?.props.disabled).toBe(false);
    await act(async () => {
      save?.props.onClick();
    });
    await settle();
    expect(phone.callsOf('strength.saveWorkout')).toEqual([
      {
        method: 'strength.saveWorkout',
        params: {
          id: null,
          name: 'Push',
          exercises: [
            {
              category: 0,
              name: 1,
              groupNo: null,
              restSecs: null,
              sets: [SET(8, 60), SET(8, 60)],
            },
          ],
          groups: [],
        },
      },
    ]);
    root.unmount();
  });
});

describe('deleting saved workouts', () => {
  const row = {
    id: 'saved-3',
    name: 'Pull',
    exerciseCount: 1,
    setCount: 2,
    lastUsedAt: null,
    createdAt: 1_800_000_000,
  };
  const held = {
    id: 'saved-3',
    name: 'Pull',
    exercises: [{ category: 0, name: 1, groupNo: null, restSecs: null, sets: [SET(8, 60)] }],
    groups: [],
  };

  // The confirm dialog reads the focused element when it opens; the test runner has no DOM.
  const globals = globalThis as { document?: unknown };
  const originalDocument = globals.document;
  beforeAll(() => {
    globals.document = { activeElement: null };
  });
  afterAll(() => {
    globals.document = originalDocument;
  });

  const rows = ['saved-1', 'saved-2', 'saved-3'].map((id, at) => ({
    ...row,
    id,
    name: `Pull ${at + 1}`,
    createdAt: 1_800_000_000 + at,
  }));

  /** Accepts every write but the delete numbered `refuseDelete` (from one), which the phone locks. */
  function phoneWithRows(refuseDelete: number | null = null) {
    let deletes = 0;
    return fakePhone((method: string, params: object) => {
      if (method === 'strength.workouts') return { workouts: rows };
      if (method === 'strength.workout') {
        return { workout: { ...held, id: (params as { id: string }).id } };
      }
      if (method === 'strength.groups') return { groups: [] };
      if (method === 'strength.picker') return { rows: [], equipment: [], muscles: [] };
      if (method === 'strength.deleteWorkout') {
        deletes += 1;
        if (deletes === refuseDelete) throw new Error('phone locked');
        return { ok: true };
      }
      if (method === 'strength.restoreWorkout') return { ok: true };
      throw new Error(`unexpected read ${method}`);
    });
  }

  async function deleteAll(phone: ReturnType<typeof phoneWithRows>) {
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        <ToastProvider dismissLabel="dismiss">
          {phone.wrap(<WorkoutsPage route={{ screen: 'workouts', id: null, query: [] }} />)}
        </ToastProvider>
      );
    });
    await settle();
    await act(async () => {
      root.root.findByProps({ tableId: 'workouts-saved' }).props.bulkActions[0].run(rows);
    });
    await act(async () => {
      root.root.findByProps({ confirmLabel: 'connectPage.workouts.delete' }).props.onConfirm();
    });
    await settle();
    const toasts = root.root.findAll(
      (node) => node.type === 'div' && node.props.className === 'ui-toast'
    );
    const undoButton = root.root.findAll(
      (node) =>
        node.type === 'button' &&
        node.findAll((inner) => inner.children.includes('connectPage.workouts.undo')).length > 0
    )[0];
    const message = toasts[0]?.findAll((node) => node.type === 'span')[0]?.children.join('');
    const undo = async () => {
      await act(async () => {
        undoButton?.props.onClick();
      });
      await settle();
    };
    return { root, toasts, message, undoButton, undo };
  }

  const restores = (
    phone: ReturnType<typeof phoneWithRows>,
    from: readonly (typeof rows)[number][]
  ) =>
    from.map((workout) => ({
      method: 'strength.restoreWorkout',
      params: { ...held, id: workout.id, createdAt: workout.createdAt, lastUsedAt: null },
    }));

  it('deletes the selection as one edit with one toast, and one undo restores every workout', async () => {
    const phone = phoneWithRows();
    const { root, toasts, message, undo } = await deleteAll(phone);
    expect(phone.callsOf('strength.deleteWorkout').map((call) => call.params)).toEqual(
      rows.map(({ id }) => ({ id }))
    );
    expect(toasts).toHaveLength(1);
    expect(message).toBe('connectPage.workouts.deleted');
    await undo();
    expect(phone.callsOf('strength.restoreWorkout')).toEqual(restores(phone, rows));
    root.unmount();
  });

  it('reads every workout before the first delete, because a delete leaves nothing to restore from', async () => {
    const phone = phoneWithRows();
    const { root } = await deleteAll(phone);
    const order = phone.calls.map((call) => call.method);
    const firstDelete = order.indexOf('strength.deleteWorkout');
    expect(
      order.slice(0, firstDelete).filter((method) => method === 'strength.workout')
    ).toHaveLength(rows.length);
    root.unmount();
  });

  it('stops at a refused delete, names the refusal and restores only the workouts already deleted', async () => {
    const phone = phoneWithRows(2);
    const { root, toasts, message, undo } = await deleteAll(phone);
    expect(phone.callsOf('strength.deleteWorkout')).toHaveLength(2);
    expect(toasts).toHaveLength(1);
    expect(message).toBe('connectPage.notice.phoneLocked');
    await undo();
    expect(phone.callsOf('strength.restoreWorkout')).toEqual(restores(phone, rows.slice(0, 1)));
    root.unmount();
  });

  it('offers no undo when the first delete is refused', async () => {
    const phone = phoneWithRows(1);
    const { root, toasts, undoButton } = await deleteAll(phone);
    expect(phone.callsOf('strength.deleteWorkout')).toHaveLength(1);
    expect(toasts).toHaveLength(0);
    expect(undoButton).toBeUndefined();
    expect(root.root.findByProps({ title: 'connectPage.notice.phoneLocked' })).toBeTruthy();
    expect(phone.callsOf('strength.restoreWorkout')).toEqual([]);
    root.unmount();
  });
});
