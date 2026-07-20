import AsyncStorage from '@react-native-async-storage/async-storage';

import { appendTaskRun, readTaskRuns, clearTaskRuns } from '@/features/insights/lib/taskRunLog';

describe('taskRunLog', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.restoreAllMocks();
  });

  it('appends and reads entries with timestamps', async () => {
    await appendTaskRun({ stage: 'fired' });
    await appendTaskRun({ stage: 'parsed', eventType: 'ACTIVITY_UPLOADED', activityId: 'a1' });

    const runs = await readTaskRuns();
    expect(runs).toHaveLength(2);
    expect(runs[0].stage).toBe('fired');
    expect(runs[1].eventType).toBe('ACTIVITY_UPLOADED');
    expect(typeof runs[0].ts).toBe('number');
  });

  it('trims to the 20 most recent entries', async () => {
    for (let i = 0; i < 25; i++) {
      await appendTaskRun({ stage: 'fired', detail: `run ${i}` });
    }
    const runs = await readTaskRuns();
    expect(runs).toHaveLength(20);
    expect(runs[0].detail).toBe('run 5');
    expect(runs[19].detail).toBe('run 24');
  });

  it('clears the log', async () => {
    await appendTaskRun({ stage: 'fired' });
    await clearTaskRuns();
    expect(await readTaskRuns()).toEqual([]);
  });

  it('returns [] on corrupt stored JSON', async () => {
    await AsyncStorage.setItem('veloq-insight-task-runs', '{not json');
    expect(await readTaskRuns()).toEqual([]);
  });

  it('filters malformed entries on read', async () => {
    await AsyncStorage.setItem(
      'veloq-insight-task-runs',
      JSON.stringify([{ ts: 1, stage: 'fired' }, { bad: true }, null, 'junk'])
    );
    const runs = await readTaskRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0].stage).toBe('fired');
  });

  it('swallows storage write failures', async () => {
    jest.spyOn(AsyncStorage, 'setItem').mockRejectedValueOnce(new Error('disk full'));
    await expect(appendTaskRun({ stage: 'error' })).resolves.toBeUndefined();
  });
});
