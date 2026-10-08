import { runSectionBoundsEdit } from '../../../modules/veloqrs/src/delegates/sections/bounds';
import type { DelegateHost } from '../../../modules/veloqrs/src/delegates/host';
import {
  type FfiSectionBoundsEdit,
  FfiSectionBoundsEdit_Tags,
} from '../../../modules/veloqrs/src/generated/veloqrs';

function fixture(edit: jest.Mock) {
  const notifyAll = jest.fn();
  const host = {
    ready: true,
    engine: { sections: () => ({ runSectionBoundsEdit: edit }) },
    timedAsync: <T>(_name: string, run: () => Promise<T>) => run(),
    notifyAll,
  } as unknown as DelegateHost;
  return { host, notifyAll };
}

const ride = { activityId: 'a1', name: 'Harbour loop', date: 1_710_200_000 };

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => jest.restoreAllMocks());

it('notifies sections readers only once the edit has ended', async () => {
  let finish: (rides: unknown[]) => void = () => {};
  const edit = jest.fn(() => new Promise((resolve) => (finish = resolve)));
  const { host, notifyAll } = fixture(edit);

  const pending = runSectionBoundsEdit(host, { kind: 'reset', sectionId: 'sec-1' });
  await Promise.resolve();
  expect(edit).toHaveBeenCalledTimes(1);
  expect(notifyAll).not.toHaveBeenCalled();

  finish([ride]);
  await expect(pending).resolves.toEqual([ride]);
  expect(notifyAll).toHaveBeenCalledWith('sections');
});

it('passes an edit that took no ride out through as an empty list', async () => {
  const { host } = fixture(jest.fn(() => Promise.resolve([])));
  await expect(
    runSectionBoundsEdit(host, { kind: 'trim', sectionId: 'sec-1', startIndex: 2, endIndex: 9 })
  ).resolves.toEqual([]);
});

it('resolves null and notifies nobody when the engine refuses the edit', async () => {
  const { host, notifyAll } = fixture(
    jest.fn(() => Promise.reject(new Error('A section edit is already running')))
  );
  await expect(
    runSectionBoundsEdit(host, {
      kind: 'expand',
      sectionId: 'sec-1',
      activityId: 'a1',
      startIndex: 0,
      endIndex: 40,
    })
  ).resolves.toBeNull();
  expect(notifyAll).not.toHaveBeenCalled();
});

it('makes no engine call before the engine has opened', async () => {
  const edit = jest.fn();
  const { host } = fixture(edit);
  await expect(
    runSectionBoundsEdit({ ...host, ready: false } as DelegateHost, {
      kind: 'reset',
      sectionId: 'sec-1',
    })
  ).resolves.toBeNull();
  expect(edit).not.toHaveBeenCalled();
});

it('hands the engine the activity a reference edit names', async () => {
  const edit = jest.fn((_sent: FfiSectionBoundsEdit) => Promise.resolve([]));
  const { host } = fixture(edit);

  await runSectionBoundsEdit(host, {
    kind: 'setReference',
    sectionId: 'sec-1',
    activityId: 'a7',
  });
  await runSectionBoundsEdit(host, { kind: 'resetReference', sectionId: 'sec-1' });

  expect(edit.mock.calls.map(([sent]) => [sent.tag, sent.inner])).toEqual([
    [FfiSectionBoundsEdit_Tags.SetReference, { sectionId: 'sec-1', activityId: 'a7' }],
    [FfiSectionBoundsEdit_Tags.ResetReference, { sectionId: 'sec-1' }],
  ]);
});

it('makes no engine call for a reference edit naming no activity', async () => {
  const edit = jest.fn();
  const { host } = fixture(edit);

  await expect(
    runSectionBoundsEdit(host, { kind: 'setReference', sectionId: 'sec-1', activityId: '' })
  ).rejects.toThrow();
  expect(edit).not.toHaveBeenCalled();
});
