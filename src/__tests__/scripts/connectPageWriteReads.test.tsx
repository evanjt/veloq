/**
 * Scenario: the workout save, rename and delete, the live set tick and the
 * detection switch run through their pages while a read of another screen is
 * held beside them.
 *
 * Expected behaviour: each write asks again the reads it names and no other
 * read held on the page or beside it.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DetectionPane } from '../../../web/connect/DetectionPane';
import { LivePage } from '../../../web/connect/pages/LivePage';
import { WorkoutsPage } from '../../../web/connect/pages/WorkoutsPage';
import type { Route } from '../../../web/connect/router';
import { Button, ConfirmDialog } from '../../../web/connect/ui';
import { useRead } from '../../../web/connect/useRead';
import { fakePhone } from '../__shared__/connectPhone';

// The dialog reads `document`, which this environment has none of; its props carry the confirm.
jest.mock('../../../web/connect/ui/Dialog', () => ({
  ...jest.requireActual('../../../web/connect/ui/Dialog'),
  ConfirmDialog: () => null,
}));

async function settle() {
  for (let at = 0; at < 8; at += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount(element: React.ReactElement) {
  let root!: ReactTestRenderer;
  await act(async () => {
    root = create(element);
  });
  await settle();
  return root;
}

/** Holds the fitness read, which none of these writes names. */
function Beside() {
  useRead('fitness.screen', {} as never);
  return null;
}

const SETTINGS = {
  enabled: true,
  strictness: { minMatchPct: 80, endpointThreshold: 200 },
  sectionConfig: {
    proximityThreshold: 50,
    minSectionLength: 500,
    maxSectionLength: 5000,
    minActivities: 3,
    divergenceThreshold: 0.2,
  },
};

const PICKER = { rows: [], equipment: [], muscles: [] };
const WORKOUT = {
  id: 'w1',
  name: 'Push',
  exercises: [{ category: 0, name: 1, groupNo: null, restSecs: null, sets: [] }],
  groups: [],
};

function workoutsPhone() {
  return fakePhone((method) => {
    switch (method) {
      case 'strength.picker':
        return PICKER;
      case 'strength.workouts':
        return {
          workouts: [
            {
              id: 'w1',
              name: 'Push',
              exerciseCount: 1,
              setCount: 3,
              lastUsedAt: null,
              createdAt: 1,
            },
          ],
        };
      case 'strength.workout':
        return { workout: WORKOUT };
      case 'strength.groups':
        return { groups: [] };
      case 'fitness.screen':
        return {};
      case 'strength.saveWorkout':
        return { id: 'w1' };
      case 'strength.renameWorkout':
      case 'strength.deleteWorkout':
        return null;
      default:
        throw new Error(`unexpected ${method}`);
    }
  });
}

const OTHER = ['fitness.screen', 'strength.groups', 'strength.picker'];

/** The calls of each read that is not named, so a widened write shows as a second. */
const others = (phone: ReturnType<typeof workoutsPhone>) =>
  Object.fromEntries(OTHER.map((method) => [method, phone.callsOf(method).length]));

describe('the workout writes', () => {
  const workouts: Route = { screen: 'workouts', id: null, query: [] };
  const workout: Route = { screen: 'workout', id: 'w1', query: [] };

  it('asks the saved workouts and the open workout again after a save, and no other read', async () => {
    const phone = workoutsPhone();
    const root = await mount(
      phone.wrap(
        <>
          <Beside />
          <WorkoutsPage route={workout} />
        </>
      )
    );
    const before = others(phone);
    const listBefore = phone.callsOf('strength.workouts').length;
    const openBefore = phone.callsOf('strength.workout').length;
    const save = root.root
      .findAllByType(Button)
      .find((button) => button.props.children === 'connectPage.workouts.save');
    await act(async () => {
      save?.props.onClick();
    });
    await settle();
    expect(phone.callsOf('strength.saveWorkout')).toHaveLength(1);
    expect(phone.callsOf('strength.workouts')).toHaveLength(listBefore + 1);
    expect(phone.callsOf('strength.workout')).toHaveLength(openBefore + 1);
    expect(others(phone)).toEqual(before);
    root.unmount();
  });

  it('asks the saved workouts and the open workout again after a rename, and no other read', async () => {
    const phone = workoutsPhone();
    const root = await mount(
      phone.wrap(
        <>
          <Beside />
          <WorkoutsPage route={workout} />
        </>
      )
    );
    const before = others(phone);
    const listBefore = phone.callsOf('strength.workouts').length;
    const openBefore = phone.callsOf('strength.workout').length;
    const rename = root.root
      .findAllByType(Button)
      .find((button) => button.props.children === 'connectPage.routes.actionRename');
    await act(async () => {
      rename?.props.onClick();
    });
    await settle();
    expect(phone.callsOf('strength.renameWorkout')).toEqual([
      { method: 'strength.renameWorkout', params: { id: 'w1', name: 'Push' } },
    ]);
    expect(phone.callsOf('strength.workouts')).toHaveLength(listBefore + 1);
    expect(phone.callsOf('strength.workout')).toHaveLength(openBefore + 1);
    expect(others(phone)).toEqual(before);
    root.unmount();
  });

  it('asks the saved workouts again after a delete, and no read of another screen', async () => {
    const phone = workoutsPhone();
    const root = await mount(
      phone.wrap(
        <>
          <Beside />
          <WorkoutsPage route={workouts} />
        </>
      )
    );
    const before = others(phone);
    const listBefore = phone.callsOf('strength.workouts').length;
    const table = root.root.findByProps({ tableId: 'workouts-saved' });
    await act(async () => {
      table.props.bulkActions[0].run([table.props.rows[0]]);
    });
    await act(async () => {
      root.root.findByType(ConfirmDialog).props.onConfirm();
    });
    await settle();
    expect(phone.callsOf('strength.deleteWorkout')).toHaveLength(1);
    expect(phone.callsOf('strength.workouts')).toHaveLength(listBefore + 1);
    expect(others(phone)).toEqual(before);
    root.unmount();
  });
});

describe('the live tick', () => {
  it('asks the live session again and no read of another screen', async () => {
    const answer = {
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
            displayName: 'Row',
            equipment: 'barbell',
            oneSided: false,
            groupNo: null,
            restSecs: 90,
            sets: [
              {
                reps: 8,
                weightKg: 40,
                displayWeight: 40,
                durationSecs: null,
                side: null,
                warmUp: false,
                done: false,
              },
            ],
          },
        ],
        groups: [],
        currentExercise: 0,
        currentSet: 0,
        restStartedAt: null,
        notes: [],
      },
      focus: {
        phase: 'set',
        current: {
          exerciseCategory: 7,
          exerciseName: null,
          setNumber: 1,
          setCount: 1,
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
        restStartedAt: null,
        restSecs: null,
        restEndsAt: null,
      },
    };
    const phone = fakePhone((method) => {
      if (method === 'strength.liveEdit') return {};
      if (method === 'fitness.screen') return {};
      return answer;
    });
    const root = await mount(
      phone.wrap(
        <>
          <Beside />
          <LivePage nowSeconds={() => 1_000_000} />
        </>
      )
    );
    const liveBefore = phone.callsOf('strength.live').length;
    const fitnessBefore = phone.callsOf('fitness.screen').length;
    await act(async () => {
      root.root.findByProps({ id: 'live-tick' }).props.onClick();
    });
    await settle();
    expect(phone.callsOf('strength.liveEdit')).toHaveLength(1);
    expect(phone.callsOf('strength.live')).toHaveLength(liveBefore + 1);
    expect(phone.callsOf('fitness.screen')).toHaveLength(fitnessBefore);
    root.unmount();
  });
});

describe('the detection switch', () => {
  it('asks the detection settings again and no read of another screen', async () => {
    const phone = fakePhone((method) => {
      if (method === 'detection.settings') return SETTINGS;
      if (method === 'detection.setEnabled') return null;
      if (method === 'fitness.screen') return {};
      throw new Error(`unexpected ${method}`);
    });
    const root = await mount(
      phone.wrap(
        <>
          <Beside />
          <DetectionPane />
        </>
      )
    );
    const settingsBefore = phone.callsOf('detection.settings').length;
    const fitnessBefore = phone.callsOf('fitness.screen').length;
    await act(async () => {
      root.root.findByProps({ id: 'detection-enabled' }).props.onChange(false);
    });
    await settle();
    expect(phone.callsOf('detection.setEnabled')).toHaveLength(1);
    expect(phone.callsOf('detection.settings')).toHaveLength(settingsBefore + 1);
    expect(phone.callsOf('fitness.screen')).toHaveLength(fitnessBefore);
    root.unmount();
  });
});
