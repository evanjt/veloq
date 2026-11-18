/**
 * Scenario: the workouts, detection and heatmap panes read and write through
 * the query layer a view shares, against a stand-in phone.
 *
 * Expected behaviour: a view that shows a read another view shows sends no
 * second request, a write reads again only the reads it names, and a failed
 * read is drawn in its own pane while the rest of the page draws.
 */

import { act, create, type ReactTestRenderer } from 'react-test-renderer';

import { DetectionPane } from '../../../web/connect/DetectionPane';
import { ManageActivity } from '../../../web/connect/pages/ActivityPage';
import { WorkoutsPage } from '../../../web/connect/pages/WorkoutsPage';
import type { Route } from '../../../web/connect/router';
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

const pickerRows = (root: ReactTestRenderer) =>
  root.root.findAll(
    (node) =>
      node.type === 'tr' &&
      typeof node.props.id === 'string' &&
      node.props.id.startsWith('workout-picker-row-')
  );

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

describe('the activity Manage panel', () => {
  it('shares the detail read with another view and reads only that again after an edit', async () => {
    let hidden = false;
    const phone = fakePhone((method) => {
      if (method === 'activity.detail') return { heatmapHidden: hidden, memberships: [] };
      if (method === 'activity.summary') return { id: 'a1' };
      if (method === 'heatmap.setHidden') {
        hidden = true;
        return { ok: true };
      }
      throw new Error(`unexpected ${method}`);
    });
    function Beside() {
      useRead('activity.detail', { id: 'a1' });
      useRead('activity.summary', { id: 'a1' });
      return null;
    }
    const root = await mount(
      phone.wrap(
        <>
          <Beside />
          <ManageActivity id="a1" onClose={() => undefined} />
        </>
      )
    );
    expect(phone.callsOf('activity.detail')).toHaveLength(1);
    await act(async () => {
      root.root.findByType('input').props.onChange({ currentTarget: { checked: false } });
    });
    await settle();
    expect(phone.callsOf('activity.detail')).toHaveLength(2);
    expect(phone.callsOf('activity.summary')).toHaveLength(1);
    expect(root.root.findByType('input').props.checked).toBe(false);
    root.unmount();
  });
});

describe('the detection pane', () => {
  it('reads the settings again after a write and leaves other reads alone', async () => {
    const phone = fakePhone((method) => {
      if (method === 'detection.settings') return SETTINGS;
      if (method === 'detection.setEnabled') return null;
      if (method === 'activity.summary') return { id: 'a1' };
      throw new Error(`unexpected ${method}`);
    });
    function Beside() {
      useRead('activity.summary', { id: 'a1' });
      return null;
    }
    const root = await mount(
      phone.wrap(
        <>
          <Beside />
          <DetectionPane />
        </>
      )
    );
    await act(async () => {
      root.root.findByProps({ id: 'detection-enabled' }).props.onChange(false);
    });
    await settle();
    expect(phone.callsOf('detection.setEnabled')).toEqual([
      { method: 'detection.setEnabled', params: { enabled: false } },
    ]);
    expect(phone.callsOf('detection.settings')).toHaveLength(2);
    expect(phone.callsOf('activity.summary')).toHaveLength(1);
    root.unmount();
  });
});

describe('the workouts page', () => {
  const route: Route = { screen: 'workouts', id: null, query: [] };
  const picker = {
    rows: [
      {
        category: 0,
        name: 1,
        labelKey: 'a',
        displayName: 'Bench press',
        equipment: 'barbell',
        lastDoneDays: null,
        usuallyNext: false,
      },
    ],
    equipment: [],
    muscles: [],
  };

  it('draws a failed last-time read in the page and keeps the picker', async () => {
    const phone = fakePhone((method) => {
      if (method === 'strength.picker') return picker;
      if (method === 'strength.workouts') return { workouts: [] };
      if (method === 'strength.groups') return { groups: [] };
      throw new Error('the phone refused');
    });
    const root = await mount(phone.wrap(<WorkoutsPage route={route} />));
    await act(async () => {
      pickerRows(root)[0]?.props.onClick({});
    });
    await settle();
    expect(root.root.findAllByProps({ id: 'workout-add-failed' }).length).toBeGreaterThan(0);
    expect(pickerRows(root)).toHaveLength(1);
    root.unmount();
  });

  it('reads the saved list again after a delete and nothing else', async () => {
    const phone = fakePhone((method) => {
      if (method === 'strength.picker') return picker;
      if (method === 'strength.workouts') {
        return { workouts: [{ id: 'w1', name: 'Push', exerciseCount: 1, setCount: 3 }] };
      }
      if (method === 'strength.groups') return { groups: [] };
      if (method === 'strength.workout') return { workout: null };
      if (method === 'strength.deleteWorkout') return null;
      throw new Error(`unexpected ${method}`);
    });
    const root = await mount(phone.wrap(<WorkoutsPage route={route} />));
    const groupsBefore = phone.callsOf('strength.groups').length;
    const pickerBefore = phone.callsOf('strength.picker').length;
    const saved = root.root.findByProps({ tableId: 'workouts-saved' });
    await act(async () => {
      saved.props.bulkActions[0].run([{ id: 'w1', name: 'Push', exerciseCount: 1, setCount: 3 }]);
    });
    await act(async () => {
      root.root.findByProps({ confirmLabel: 'connectPage.workouts.delete' }).props.onConfirm();
    });
    await settle();
    expect(phone.callsOf('strength.deleteWorkout')).toEqual([
      { method: 'strength.deleteWorkout', params: { id: 'w1' } },
    ]);
    expect(phone.callsOf('strength.workouts')).toHaveLength(2);
    expect(phone.callsOf('strength.groups')).toHaveLength(groupsBefore);
    expect(phone.callsOf('strength.picker')).toHaveLength(pickerBefore);
    root.unmount();
  });
});
