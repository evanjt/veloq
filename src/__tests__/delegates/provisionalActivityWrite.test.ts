import { saveProvisionalActivity } from '../../../modules/veloqrs/src/delegates/activities';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';
import type {
  FfiActivityBody,
  FfiActivityMetrics,
} from '../../../modules/veloqrs/src/generated/veloqrs';

jest.mock('../../../modules/veloqrs/src/conversions', () => ({ validateId: jest.fn() }));

const BODY: FfiActivityBody = { activityId: 'local-test', date: 1000, raw: '{}' };
const METRICS: FfiActivityMetrics = {
  activityId: 'local-test',
  name: 'Ride',
  date: 1000,
  distance: 50,
  movingTime: 30,
  elapsedTime: 30,
  elevationGain: 0,
  sportType: 'Ride',
};

function fixture(ready = true) {
  const save = jest.fn();
  const notify = jest.fn();
  const host = {
    ready,
    engine: { activities: () => ({ saveProvisional: save }) },
    timed: <T>(_name: string, run: () => T) => run(),
    notifyAll: notify,
  } as unknown as DelegateHost;
  return { host, save, notify };
}

it('waits for the native commit before notifying activity readers', async () => {
  const { host, save, notify } = fixture();
  let commit!: () => void;
  save.mockReturnValue(
    new Promise<void>((resolve) => {
      commit = resolve;
    })
  );
  const pending = saveProvisionalActivity(host, 'local-test', [], BODY, METRICS);
  expect(notify).not.toHaveBeenCalled();
  commit();
  expect(await pending).toBe(true);
  expect(notify).toHaveBeenCalledWith('activities', 'groups');
});

it('does not notify readers when the native transaction rejects', async () => {
  const { host, save, notify } = fixture();
  save.mockRejectedValue(new Error('disk full'));
  await expect(saveProvisionalActivity(host, 'local-test', [], BODY, METRICS)).rejects.toThrow(
    'disk full'
  );
  expect(notify).not.toHaveBeenCalled();
});

it('answers false without reaching Rust when the engine is closed', async () => {
  const { host, save, notify } = fixture(false);
  expect(await saveProvisionalActivity(host, 'local-test', [], BODY, METRICS)).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});
