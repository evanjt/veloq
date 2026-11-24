import {
  createRestAlert,
  type RestAlertPort,
} from '@/features/recording/lib/liveActivity/restAlert';

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
