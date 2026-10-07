import { saveProvisionalActivity } from '../../../modules/veloqrs/src/delegates/activities';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';
import type { FfiActivityBody } from '../../../modules/veloqrs/src/generated/veloqrs';

jest.mock('../../../modules/veloqrs/src/conversions', () => ({ validateId: jest.fn() }));

const BODY: FfiActivityBody = { activityId: 'local-test', date: 1000, raw: '{}' };
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
  const pending = saveProvisionalActivity(host, 'local-test', 'file:///recordings/r.fit', BODY);
  expect(notify).not.toHaveBeenCalled();
  commit();
  expect(await pending).toBe(true);
  expect(save).toHaveBeenCalledWith('local-test', 'file:///recordings/r.fit', BODY);
  expect(notify).toHaveBeenCalledWith('activities', 'groups');
});

it('does not notify readers when the native transaction rejects', async () => {
  const { host, save, notify } = fixture();
  save.mockRejectedValue(new Error('disk full'));
  await expect(saveProvisionalActivity(host, 'local-test', undefined, BODY)).rejects.toThrow(
    'disk full'
  );
  expect(notify).not.toHaveBeenCalled();
});

it('answers false without reaching Rust when the engine is closed', async () => {
  const { host, save, notify } = fixture(false);
  expect(await saveProvisionalActivity(host, 'local-test', undefined, BODY)).toBe(false);
  expect(save).not.toHaveBeenCalled();
  expect(notify).not.toHaveBeenCalled();
});
