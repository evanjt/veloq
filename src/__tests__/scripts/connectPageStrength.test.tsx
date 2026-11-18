/**
 * Scenario: an athlete opens the strength page and the workout builder in a desktop browser
 * linked to a phone that holds a library with strength sessions.
 *
 * Expected behaviour: `#/strength` is its own page under the insights tab; the exercise list is a
 * shared table with a row per exercise; each week's most-worked figure is that week's own maximum;
 * a recent session's exercises find their names whether the engine sent a name number or none;
 * dragging moves an exercise to the place it is dropped; renaming a saved workout sends the
 * rename write and not a full save.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { pageFor } from '../../../web/connect/pages';
import type { PageProps } from '../../../web/connect/pages/types';
import { StrengthPage } from '../../../web/connect/pages/Strength';
import { WorkoutsPage } from '../../../web/connect/pages/WorkoutsPage';
import { parse, tabOf } from '../../../web/connect/router';
import {
  blankDraft,
  exerciseKey,
  movedTo,
  namesOf,
  withExercise,
} from '../../../web/connect/workoutBuilder';
import { muscleSplit } from '../../../web/connect/strengthView';
import { Button } from '../../../web/connect/ui';
import { demoResults } from '../__shared__/connectDemoLibrary';
import { fakePhone } from '../__shared__/connectPhone';

const results = demoResults() as unknown as Record<string, unknown>;

const demoPhone = () =>
  fakePhone((method) => {
    if (method in results) return results[method];
    if (method === 'strength.renameWorkout' || method === 'strength.deleteWorkout') {
      return { ok: true };
    }
    throw new Error(`unexpected read ${method}`);
  });

async function settle() {
  for (let at = 0; at < 8; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

const strengthProps = (hash: string) =>
  ({ route: parse(hash), session: undefined, snapshot: undefined }) as unknown as PageProps;

describe('the address', () => {
  it('names the strength page under the insights tab, with its period in the query', () => {
    expect(parse('#/strength').screen).toBe('strength');
    expect(parse('#/strength?period=3m').query).toEqual([['period', '3m']]);
    expect(tabOf(parse('#/strength'))).toBe('insights');
    expect(pageFor(parse('#/strength')).key).toBe('strength');
    expect(parse('#/strength/7').screen).toBe('activities');
  });
});

describe('the demo strength weeks', () => {
  it('reports each week its own most-worked muscle, which is that week’s largest weighted sets', () => {
    const weekly = (
      results['strength.screen'] as {
        weekly: { maxWeightedSets: number; muscleVolumes: { weightedSets: number }[] }[];
      }
    ).weekly;
    for (const week of weekly) {
      expect(week.maxWeightedSets).toBe(Math.max(...week.muscleVolumes.map((m) => m.weightedSets)));
    }
    expect(new Set(weekly.map((week) => week.maxWeightedSets)).size).toBeGreaterThan(1);
  });
});

describe('exercise names', () => {
  const rows = [
    { category: 0, name: 0, displayName: 'Bench press' },
    { category: 0, name: 1, displayName: 'Incline press' },
    { category: 5, name: 3, displayName: 'Row' },
  ] as never;

  it('finds the name of an exercise the engine sent without a name number', () => {
    const names = namesOf(rows);
    expect(names.get(exerciseKey(0, null))).toBe('Bench press');
    expect(names.get(exerciseKey(0, 1))).toBe('Incline press');
  });

  it('gives a category with no zero row the first row it has, and an unknown one nothing', () => {
    const names = namesOf(rows);
    expect(names.get(exerciseKey(5, null))).toBe('Row');
    expect(names.get(exerciseKey(9, null))).toBeUndefined();
  });
});

describe('dragging an exercise', () => {
  const draft = [3, 4, 5, 6].reduce(
    (held, category) => withExercise(held, category, null, []),
    blankDraft()
  );
  const order = (value: typeof draft) => value.exercises.map((exercise) => exercise.category);

  it('moves it to the place it is dropped, over any distance', () => {
    expect(order(movedTo(draft, 0, 2))).toEqual([4, 5, 3, 6]);
    expect(order(movedTo(draft, 3, 0))).toEqual([6, 3, 4, 5]);
  });

  it('leaves the draft alone when dropped where it was or off the list', () => {
    expect(movedTo(draft, 1, 1)).toBe(draft);
    expect(movedTo(draft, 1, 9)).toBe(draft);
    expect(movedTo(draft, -1, 0)).toBe(draft);
  });
});

describe('the strength page', () => {
  it('lists every exercise of the period in the shared table', async () => {
    const phone = demoPhone();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(phone.wrap(<StrengthPage {...strengthProps('#/strength?period=3m')} />));
    });
    await settle();
    const rows = root.root.findAll(
      (node) =>
        node.type === 'tr' &&
        typeof node.props['data-row'] === 'string' &&
        String(node.props.id).startsWith('strength-exercises-row-')
    );
    const screen = results['strength.screen'] as {
      exercises: { exercises: { exerciseCategory: number }[] }[];
    };
    const categories = new Set(
      screen.exercises.flatMap((group) => group.exercises.map((e) => e.exerciseCategory))
    );
    expect(rows.length).toBe(categories.size);
    expect(phone.callsOf('strength.screen')[0]?.params).toMatchObject({ periodDays: 90 });
    root.unmount();
  });
});

describe('the workouts page', () => {
  it('renames a saved workout with the rename write and not a full save', async () => {
    const phone = demoPhone();
    const saved = (results['strength.workouts'] as { workouts: { id: string }[] }).workouts[0];
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        phone.wrap(<WorkoutsPage route={{ screen: 'workout', id: saved.id, query: [] }} />)
      );
    });
    await settle();
    await act(async () => {
      root.root
        .findAll((node) => node.type === 'input' && node.props.id === 'workout-name')[0]
        .props.onChange({ currentTarget: { value: 'Pull day' } });
    });
    const rename = root.root
      .findAllByType(Button)
      .find((button) => button.props.children === 'connectPage.routes.actionRename');
    await act(async () => {
      rename?.props.onClick();
    });
    await settle();
    expect(phone.callsOf('strength.renameWorkout')).toEqual([
      { method: 'strength.renameWorkout', params: { id: saved.id, name: 'Pull day' } },
    ]);
    expect(phone.callsOf('strength.saveWorkout')).toEqual([]);
    root.unmount();
  });
});

describe('a muscle over the period', () => {
  const groups = [
    {
      muscleSlug: 'chest',
      exercises: [
        { exerciseCategory: 1, isPrimary: true },
        { exerciseCategory: 2, isPrimary: true },
        { exerciseCategory: 3, isPrimary: false },
      ],
    },
    { muscleSlug: 'triceps', exercises: [{ exerciseCategory: 1, isPrimary: false }] },
  ] as never;

  it('counts the exercises that target it first and those that only assist', () => {
    expect(muscleSplit(groups, 'chest')).toEqual({ primary: 2, secondary: 1 });
    expect(muscleSplit(groups, 'triceps')).toEqual({ primary: 0, secondary: 1 });
  });

  it('has no split for no muscle or one the period did not train', () => {
    expect(muscleSplit(groups, null)).toBeNull();
    expect(muscleSplit(groups, 'calves')).toBeNull();
  });

  it('shows the split on the page when a muscle is chosen', async () => {
    const screen = results['strength.screen'] as {
      exercises: { muscleSlug: string; exercises: { isPrimary: boolean }[] }[];
    };
    const group = screen.exercises[0];
    const phone = demoPhone();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        phone.wrap(
          <StrengthPage {...strengthProps(`#/strength?period=3m&muscle=${group.muscleSlug}`)} />
        )
      );
    });
    await settle();
    const split = root.root.findByProps({ id: 'strength-muscle-split' });
    const primary = group.exercises.filter((e) => e.isPrimary).length;
    expect(split.props['data-primary']).toBe(primary);
    expect(split.props['data-secondary']).toBe(group.exercises.length - primary);
    root.unmount();
  });

  it('narrows the exercise table to the filter text in the address and shows it in the field', async () => {
    const screen = results['strength.screen'] as {
      exercises: { exercises: { exerciseCategory: number; exerciseName: string }[] }[];
    };
    const names = new Map(
      screen.exercises.flatMap((group) =>
        group.exercises.map((e) => [e.exerciseCategory, e.exerciseName] as const)
      )
    );
    const [category, name] = [...names][0]!;
    const phone = demoPhone();
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(
        phone.wrap(
          <StrengthPage {...strengthProps(`#/strength?period=3m&q=${encodeURIComponent(name)}`)} />
        )
      );
    });
    await settle();
    const rows = root.root.findAll(
      (node) =>
        node.type === 'tr' &&
        typeof node.props['data-row'] === 'string' &&
        String(node.props.id).startsWith('strength-exercises-row-')
    );
    const expected = [...names.values()].filter((other) =>
      other.toLowerCase().includes(name.toLowerCase())
    );
    expect(rows.length).toBe(expected.length);
    expect(rows.length).toBeLessThan(names.size);
    expect(rows.some((row) => String(row.props.id).endsWith(String(category)))).toBe(true);
    expect(root.root.findAllByProps({ role: 'search' }).length).toBeGreaterThan(0);
    expect(root.root.findAllByType('input').some((input) => input.props.value === name)).toBe(true);
    root.unmount();
  });
});
