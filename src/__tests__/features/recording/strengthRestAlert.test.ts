import { startFollow, advance, type PlanLine } from '@/features/recording/lib/planFollow';
import { buildStrengthContentState } from '@/features/recording/lib/liveActivity/strengthContentState';
import {
  createRestAlert,
  type RestAlertPort,
} from '@/features/recording/lib/liveActivity/restAlert';

const SEC = 1000;
const work = (text: string, durationSeconds: number | null = null): PlanLine => ({
  kind: 'work',
  text,
  durationSeconds,
});
const rest = (durationSeconds: number): PlanLine => ({ kind: 'rest', text: '', durationSeconds });

const lines = [work('Squat 5x5'), rest(90), work('Bench press 5x5'), rest(60), work('Row 5x5')];

describe('strength live content state', () => {
  it('reads a set as the exercise with the next line after it and no rest end', () => {
    const state = buildStrengthContentState(startFollow(lines, 1000), 1000);
    expect(state).toMatchObject({
      phase: 'set',
      exercise: 'Squat 5x5',
      nextSet: 'Bench press 5x5',
      restEndsAt: null,
    });
  });

  it('reads a rest as ending at the line start plus its length, naming the set that follows', () => {
    const follow = advance(startFollow(lines, 1000), 11_000);
    const state = buildStrengthContentState(follow, 12_000);
    expect(state).toMatchObject({
      phase: 'rest',
      exercise: 'Squat 5x5',
      nextSet: 'Bench press 5x5',
      restEndsAt: 11_000 + 90 * SEC,
    });
  });

  it('has no next set on the last line', () => {
    let follow = startFollow(lines, 0);
    for (let i = 0; i < 4; i += 1) follow = advance(follow, 1000 * (i + 1));
    expect(buildStrengthContentState(follow, 5000)).toMatchObject({
      phase: 'set',
      exercise: 'Row 5x5',
      nextSet: null,
    });
  });

  it('is null once the session has finished', () => {
    const follow = { ...startFollow(lines, 0), finishedAt: 10 };
    expect(buildStrengthContentState(follow, 20)).toBeNull();
  });

  it('treats an untimed rest as a rest with no end time', () => {
    const open = [work('Curl'), { kind: 'rest', text: '', durationSeconds: null } as PlanLine];
    const follow = advance(startFollow(open, 0), 1000);
    expect(buildStrengthContentState(follow, 2000)).toMatchObject({
      phase: 'rest',
      restEndsAt: null,
    });
  });
});

function fakePort() {
  const scheduled = new Map<string, number>();
  const calls: string[] = [];
  const port: RestAlertPort = {
    schedule: async (id, fireAt, title) => {
      calls.push(`schedule ${id} ${fireAt} ${title}`);
      scheduled.set(id, fireAt);
    },
    cancel: async (id) => {
      calls.push(`cancel ${id}`);
      scheduled.delete(id);
    },
  };
  return { port, scheduled, calls };
}

describe('rest alert', () => {
  it('schedules one alert at the rest end', async () => {
    const { port, scheduled } = fakePort();
    const alert = createRestAlert(port);
    await alert.sync(100_000, 1_000, 'Next');
    expect([...scheduled.values()]).toEqual([100_000]);
  });

  it('titles the alert with the set that follows', async () => {
    const { port, calls } = fakePort();
    await createRestAlert(port).sync(100_000, 1_000, 'Bench press');
    expect(calls).toEqual(['schedule strength-rest-end 100000 Bench press']);
  });

  it('cancels it when rest ends early', async () => {
    const { port, scheduled } = fakePort();
    const alert = createRestAlert(port);
    await alert.sync(100_000, 1_000, 'Next');
    await alert.sync(null, 50_000, 'Next');
    expect(scheduled.size).toBe(0);
  });

  it('replaces the first alert when a second rest starts', async () => {
    const { port, scheduled } = fakePort();
    const alert = createRestAlert(port);
    await alert.sync(100_000, 1_000, 'Next');
    await alert.sync(200_000, 100_500, 'Next');
    expect([...scheduled.values()]).toEqual([200_000]);
  });

  it('does not reschedule an unchanged rest end', async () => {
    const { port, calls } = fakePort();
    const alert = createRestAlert(port);
    await alert.sync(100_000, 1_000, 'Next');
    await alert.sync(100_000, 2_000, 'Next');
    expect(calls).toHaveLength(1);
  });

  it('schedules nothing for a rest end already past', async () => {
    const { port, calls } = fakePort();
    const alert = createRestAlert(port);
    await alert.sync(1_000, 5_000, 'Next');
    expect(calls).toEqual([]);
  });

  it('cancels a pending alert on clear, and not twice', async () => {
    const { port, scheduled, calls } = fakePort();
    const alert = createRestAlert(port);
    await alert.sync(100_000, 1_000, 'Next');
    await alert.clear();
    await alert.clear();
    expect(scheduled.size).toBe(0);
    expect(calls.filter((c) => c.startsWith('cancel'))).toHaveLength(1);
  });

  it('keeps going when the port rejects', async () => {
    const alert = createRestAlert({
      schedule: async () => {
        throw new Error('denied');
      },
      cancel: async () => undefined,
    });
    await expect(alert.sync(100_000, 1_000, 'Next')).resolves.toBeUndefined();
  });
});
