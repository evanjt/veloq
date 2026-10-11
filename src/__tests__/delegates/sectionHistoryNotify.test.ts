import { unpinSection } from '../../../modules/veloqrs/src/delegates/sections/history';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

function fixture() {
  const unpin = jest.fn();
  const notify = jest.fn();
  const host = {
    ready: true,
    engine: { sections: () => ({ unpin }) },
    timed: <T>(_name: string, run: () => T) => run(),
    notify,
  } as unknown as DelegateHost;
  return { host, unpin, notify };
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

it('notifies sections after an unpin and not after a failed one', () => {
  const { host, unpin, notify } = fixture();
  expect(unpinSection(host, 'sec-1')).toBe(true);
  expect(notify).toHaveBeenCalledWith('sections');
  notify.mockClear();
  unpin.mockImplementation(() => {
    throw new Error('x');
  });
  expect(unpinSection(host, 'sec-1')).toBe(false);
  expect(notify).not.toHaveBeenCalled();
});
