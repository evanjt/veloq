/**
 * Scenario: a restore drops route names to a merged route, or history whose
 * section no longer exists. Expected behaviour: the notice says how many,
 * beside the restored line, rather than claiming everything came back.
 */

import type { TFunction } from 'i18next';

import { showRestoreNotice } from '@/features/settings/lib/restoreNotice';
import { showNotice } from '@/shared/ui/Notice';

jest.mock('@/shared/ui/Notice', () => ({
  ...jest.requireActual('@/shared/ui/Notice'),
  showNotice: jest.fn(() => 1),
}));

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as unknown as TFunction;

function shownMessage(): string {
  const calls = (showNotice as jest.Mock).mock.calls;
  return calls[calls.length - 1][0].message;
}

beforeEach(() => (showNotice as jest.Mock).mockClear());

it('names the route names a restore dropped beside the restored line', () => {
  showRestoreNotice({ notRestored: 0, namesNotRestored: 19 }, t);
  expect(shownMessage().split('\n')).toEqual([
    'backup.recordRestored',
    'backup.namesNotRestored:{"count":19}',
  ]);
});

it('names the history a restore dropped beside the restored line', () => {
  showRestoreNotice({ notRestored: 26, namesNotRestored: 0 }, t);
  expect(shownMessage().split('\n')).toEqual([
    'backup.recordRestored',
    'backup.historyNotRestored:{"count":26}',
  ]);
});

it('names both drops when a restore made both', () => {
  showRestoreNotice({ notRestored: 1, namesNotRestored: 2 }, t);
  expect(shownMessage().split('\n')).toEqual([
    'backup.recordRestored',
    'backup.namesNotRestored:{"count":2}',
    'backup.historyNotRestored:{"count":1}',
  ]);
});

it('shows the restored line alone when nothing was dropped', () => {
  showRestoreNotice({ notRestored: 0, namesNotRestored: 0 }, t);
  expect(shownMessage()).toBe('backup.recordRestored');
});

it('says a held backup waits for sign-in', () => {
  showRestoreNotice('held', t);
  expect(shownMessage()).toBe('backup.heldUntilSignIn');
});
