import {
  resetRouteRepresentative,
  setRouteRepresentative,
} from '../../../modules/veloqrs/src/delegates/routes';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

function fixture(choose: jest.Mock) {
  const notify = jest.fn();
  const host = {
    ready: true,
    engine: { routes: () => ({ setRepresentative: choose }) },
    timedAsync: <T>(_name: string, run: () => Promise<T>) => run(),
    notify,
  } as unknown as DelegateHost;
  return { host, notify };
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

it('notifies route readers only once the choice has been written', async () => {
  let finish: () => void = () => {};
  const choose = jest.fn(() => new Promise<void>((resolve) => (finish = resolve)));
  const { host, notify } = fixture(choose);

  const pending = setRouteRepresentative(host, 'route-ridge', 'ride-2');
  await Promise.resolve();
  expect(choose).toHaveBeenCalledWith('route-ridge', 'ride-2');
  expect(notify).not.toHaveBeenCalled();

  finish();
  await expect(pending).resolves.toBe(true);
  expect(notify).toHaveBeenCalledWith('groups');
});

it('resets through the same choice with no activity named', async () => {
  const choose = jest.fn(() => Promise.resolve());
  const { host, notify } = fixture(choose);

  await expect(resetRouteRepresentative(host, 'route-ridge')).resolves.toBe(true);
  expect(choose).toHaveBeenCalledWith('route-ridge', undefined);
  expect(notify).toHaveBeenCalledWith('groups');
});

it('resolves false and notifies nobody when the engine refuses the choice', async () => {
  const { host, notify } = fixture(
    jest.fn(() => Promise.reject(new Error('A route representative is already being chosen')))
  );

  await expect(setRouteRepresentative(host, 'route-ridge', 'ride-2')).resolves.toBe(false);
  await expect(resetRouteRepresentative(host, 'route-ridge')).resolves.toBe(false);
  expect(notify).not.toHaveBeenCalled();
});

it('makes no engine call before the engine has opened', async () => {
  const choose = jest.fn();
  const { host } = fixture(choose);
  const closed = { ...host, ready: false } as DelegateHost;

  await expect(setRouteRepresentative(closed, 'route-ridge', 'ride-2')).resolves.toBe(false);
  await expect(resetRouteRepresentative(closed, 'route-ridge')).resolves.toBe(false);
  expect(choose).not.toHaveBeenCalled();
});
