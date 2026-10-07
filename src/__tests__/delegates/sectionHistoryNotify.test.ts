import {
  revertSectionToVersion,
  unpinSection,
} from '../../../modules/veloqrs/src/delegates/sections/history';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';

function fixture() {
  const revert = jest.fn();
  const unpin = jest.fn();
  const notify = jest.fn();
  const notifyAll = jest.fn();
  const host = {
    ready: true,
    engine: { sections: () => ({ revertToVersion: revert, unpin }) },
    timed: <T>(_name: string, run: () => T) => run(),
    notify,
    notifyAll,
  } as unknown as DelegateHost;
  return { host, revert, unpin, notify, notifyAll };
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

it('notifies every sections reader after a revert rewrites the line', () => {
  const { host, revert, notifyAll } = fixture();
  revert.mockReturnValue([]);
  expect(revertSectionToVersion(host, 'sec-1', 2)).toEqual([]);
  expect(notifyAll).toHaveBeenCalledWith('sections');
});

it('does not notify when the revert fails', () => {
  const { host, revert, notify, notifyAll } = fixture();
  revert.mockImplementation(() => {
    throw new Error('no such version');
  });
  expect(revertSectionToVersion(host, 'sec-1', 9)).toBeNull();
  expect(notify).not.toHaveBeenCalled();
  expect(notifyAll).not.toHaveBeenCalled();
});

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
