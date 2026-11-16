/**
 * Scenario: the athlete follows a strength session recorded on the phone from
 * the linked browser.
 *
 * Expected behaviour: the pane shows the set the engine's focus names and the
 * rest left; a tick is the one write the link allows and the pane redraws from
 * what the engine answers next; a new announcement is read again; a refused
 * write shows its reason and changes nothing.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { LivePage } from '../../../web/connect/pages/LivePage';
import {
  clock,
  completeSet,
  restRemaining,
  typedSet,
  typedValue,
  type LiveAnswer,
} from '../../../web/connect/liveSession';
import { parse, tabOf } from '../../../web/connect/router';
import { fakePhone } from '../__shared__/connectPhone';

const set = (done: boolean) => ({
  reps: 8,
  weightKg: 40,
  displayWeight: 40,
  durationSecs: null,
  side: null,
  warmUp: false,
  done,
});

function answer(doneCount: number, restEndsAt: number | null): LiveAnswer {
  return {
    session: {
      id: 's1',
      weightUnit: 'kilogram',
      begun: true,
      startedAt: 1,
      exercises: [
        {
          category: 7,
          name: null,
          labelKey: '',
          displayName: 'Bench press',
          equipment: 'barbell',
          oneSided: false,
          groupNo: null,
          restSecs: 90,
          sets: [set(doneCount > 0), set(doneCount > 1), set(false)],
        },
      ],
      groups: [],
      currentExercise: 0,
      currentSet: doneCount,
      restStartedAt: restEndsAt === null ? null : restEndsAt - 90,
      notes: [],
    },
    focus: {
      phase: restEndsAt === null ? 'set' : 'rest',
      current: {
        exerciseCategory: 7,
        exerciseName: null,
        setNumber: doneCount + 1,
        setCount: 3,
        reps: 8,
        weightKg: 40,
        displayWeight: 40,
        weightUnit: 'kilogram',
        weightStep: 2.5,
        weightDownKg: 37.5,
        weightUpKg: 42.5,
        durationSecs: null,
        warmUp: false,
      },
      previous: null,
      next: null,
      restStartedAt: restEndsAt === null ? null : restEndsAt - 90,
      restSecs: restEndsAt === null ? null : 90,
      restEndsAt,
    },
  } as unknown as LiveAnswer;
}

async function settle() {
  for (let at = 0; at < 6; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

function phoneHolding(held: { value: LiveAnswer }, refusal?: string) {
  return fakePhone((method) => {
    if (method === 'strength.liveEdit') {
      if (refusal) throw new Error(refusal);
      held.value = answer(1, 1_000_090);
      return {};
    }
    return held.value;
  });
}

const text = (root: ReactTestRenderer, id: string) =>
  JSON.stringify(root.root.findByProps({ id }).props.children);

describe('the live session pane', () => {
  it('shows the set to do and the rest left from the engine focus', async () => {
    const held = { value: answer(1, 1_000_090) };
    const phone = phoneHolding(held);
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(phone.wrap(<LivePage nowSeconds={() => 1_000_000} />));
    });
    await settle();
    expect(text(root, 'live-set')).toContain('connectPage.live.setOf');
    expect(root.root.findByProps({ id: 'live-rest' })).toBeTruthy();
    root.unmount();
  });

  it('ticks through the one write and redraws from the engine answer', async () => {
    const held = { value: answer(0, null) };
    const phone = phoneHolding(held);
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(phone.wrap(<LivePage nowSeconds={() => 1_000_000} />));
    });
    await settle();
    expect(root.root.findAllByProps({ id: 'live-rest' })).toHaveLength(0);
    await act(async () => {
      root.root.findByProps({ id: 'live-tick' }).props.onClick();
    });
    await settle();
    expect(phone.callsOf('strength.liveEdit')).toEqual([
      { method: 'strength.liveEdit', params: { edit: completeSet(0, 0) } },
    ]);
    expect(root.root.findByProps({ id: 'live-rest' })).toBeTruthy();
    const rows = root.root
      .findByProps({ id: 'live-sets' })
      .findAllByType('tr')
      .filter((row) => row.props['data-row']);
    expect(rows.map((row) => row.props['data-done'])).toEqual([true, false, false]);
    root.unmount();
  });

  it('reads the session again when the phone announces a change', async () => {
    const held = { value: answer(0, null) };
    const phone = phoneHolding(held);
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(phone.wrap(<LivePage />));
    });
    await settle();
    held.value = answer(2, null);
    await act(async () => {
      phone.queries.changed();
    });
    await settle();
    expect(phone.callsOf('strength.live')).toHaveLength(2);
    const rows = root.root
      .findByProps({ id: 'live-sets' })
      .findAllByType('tr')
      .filter((row) => row.props['data-row']);
    expect(rows.map((row) => row.props['data-done'])).toEqual([true, true, false]);
    root.unmount();
  });

  it('shows why a write was refused and keeps the session as it was', async () => {
    const held = { value: answer(0, null) };
    const phone = phoneHolding(held, 'no strength session is live');
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(phone.wrap(<LivePage />));
    });
    await settle();
    await act(async () => {
      root.root.findByProps({ id: 'live-tick' }).props.onClick();
    });
    await settle();
    expect(text(root, 'live-refused')).toContain('no strength session is live');
    expect(root.root.findByProps({ id: 'live-set' })).toBeTruthy();
    root.unmount();
  });

  it('says so when no session is live', async () => {
    const held = { value: { session: null, focus: null } as LiveAnswer };
    const phone = phoneHolding(held);
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(phone.wrap(<LivePage />));
    });
    await settle();
    expect(root.root.findAllByProps({ id: 'live-current' })).toHaveLength(0);
    root.unmount();
  });
});

describe('the live session table', () => {
  const twoExercises = (): LiveAnswer => {
    const base = answer(0, null);
    const second = {
      ...base.session!.exercises[0],
      displayName: 'Row',
      sets: [set(false), set(false)],
    };
    return {
      ...base,
      session: {
        ...base.session!,
        exercises: [base.session!.exercises[0], second],
        currentExercise: 1,
        currentSet: 0,
      },
    } as LiveAnswer;
  };

  async function mount(held: { value: LiveAnswer }) {
    const phone = phoneHolding(held);
    const focused: string[] = [];
    let root!: ReactTestRenderer;
    await act(async () => {
      root = create(phone.wrap(<LivePage />), {
        createNodeMock: (element) => ({
          focus: () =>
            focused.push(String((element.props as Record<string, unknown>)['aria-label'])),
          select: () => undefined,
          blur: () => undefined,
        }),
      });
    });
    await settle();
    return { phone, root, focused };
  }

  it('lists every set of every exercise in one table', async () => {
    const { root } = await mount({ value: twoExercises() });
    const tables = root.root.findAll((node) => node.type === 'table');
    expect(tables).toHaveLength(1);
    expect(tables[0].props.className).toBe('ui-table');
    const rows = tables[0].findAllByType('tr').filter((row) => row.props['data-row']);
    expect(rows).toHaveLength(5);
    root.unmount();
  });

  it('sends the typed weight on Enter and moves focus to the next set weight', async () => {
    const { root, phone, focused } = await mount({ value: twoExercises() });
    const weights = root.root.findAll(
      (node) => node.type === 'input' && node.props['data-cell'] === 'weight'
    );
    expect(weights).toHaveLength(5);
    await act(async () => {
      weights[0].props.onKeyDown({
        key: 'Enter',
        preventDefault: () => undefined,
        currentTarget: { value: '45' },
      });
    });
    await settle();
    expect(phone.callsOf('strength.liveEdit')).toEqual([
      { method: 'strength.liveEdit', params: { edit: typedSet(0, 0, 'weight', 45) } },
    ]);
    expect(focused).toEqual([String(weights[1].props['aria-label'])]);
    root.unmount();
  });

  it('crosses from the last set of one exercise to the first of the next', async () => {
    const { root, focused } = await mount({ value: twoExercises() });
    const weights = root.root.findAll(
      (node) => node.type === 'input' && node.props['data-cell'] === 'weight'
    );
    await act(async () => {
      weights[2].props.onKeyDown({
        key: 'Enter',
        preventDefault: () => undefined,
        currentTarget: { value: '40' },
      });
    });
    expect(focused).toHaveLength(1);
    root.unmount();
  });

  it('does not send on Escape and does not send an unchanged value', async () => {
    const { root, phone } = await mount({ value: twoExercises() });
    const weights = root.root.findAll(
      (node) => node.type === 'input' && node.props['data-cell'] === 'weight'
    );
    const reset = { value: '99' };
    await act(async () => {
      weights[0].props.onKeyDown({
        key: 'Escape',
        preventDefault: () => undefined,
        currentTarget: { ...reset, blur: () => undefined },
      });
      weights[1].props.onKeyDown({
        key: 'Enter',
        preventDefault: () => undefined,
        currentTarget: { value: '40' },
      });
    });
    await settle();
    expect(phone.callsOf('strength.liveEdit')).toHaveLength(0);
    root.unmount();
  });

  it('names the exercise the session marks live in the current-set panel', async () => {
    const { root } = await mount({ value: twoExercises() });
    expect(text(root, 'live-exercise')).toContain('Row');
    root.unmount();
  });
});

describe('the live helpers', () => {
  it('counts the rest down to zero and not below, and only while resting', () => {
    const resting = answer(1, 1_000_090).focus;
    expect(restRemaining(resting, 1_000_000)).toBe(90);
    expect(restRemaining(resting, 1_000_089.2)).toBe(1);
    expect(restRemaining(resting, 1_000_200)).toBe(0);
    expect(restRemaining(answer(0, null).focus, 1)).toBeNull();
    expect(restRemaining(null, 1)).toBeNull();
    expect(clock(65)).toBe('1:05');
  });

  it('reads a typed value: empty clears, a bad one is refused', () => {
    expect(typedValue('')).toBeNull();
    expect(typedValue(' 42.5 ')).toBe(42.5);
    expect(typedValue('-1')).toBeUndefined();
    expect(typedValue('abc')).toBeUndefined();
    expect(typedSet(0, 1, 'weight', 45)).toMatchObject({
      kind: 'setWeightEntered',
      exercise: 0,
      set: 1,
      value: 45,
    });
  });

  it('names the address under the insights tab', () => {
    expect(parse('#/live').screen).toBe('live');
    expect(tabOf(parse('#/live'))).toBe('insights');
  });
});
