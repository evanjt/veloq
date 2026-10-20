/**
 * Scenario: a restore drops route names to a merged route, or history whose
 * section no longer exists, or comes from a file that left the export privacy
 * home out. Expected behaviour: the notice says how many, or that the home has
 * to be set again with a way to its setting, beside the restored line, rather
 * than claiming everything came back.
 */

import type { TFunction } from 'i18next';

import { showRestoreNotice } from '@/features/settings/lib/restoreNotice';
import { showNotice } from '@/shared/ui/Notice';

const mockNavigate = jest.fn();
jest.mock('expo-router', () => ({
  ...jest.requireActual('expo-router'),
  router: { navigate: (to: string) => mockNavigate(to) },
}));

jest.mock('@/shared/ui/Notice', () => ({
  ...jest.requireActual('@/shared/ui/Notice'),
  showNotice: jest.fn(() => 1),
}));

const t = ((key: string, values?: Record<string, unknown>) =>
  values ? `${key}:${JSON.stringify(values)}` : key) as unknown as TFunction;

function shown(): { message: string; action?: { label: string; onPress: () => void } } {
  const calls = (showNotice as jest.Mock).mock.calls;
  return calls[calls.length - 1][0];
}

function shownMessage(): string {
  return shown().message;
}

beforeEach(() => {
  (showNotice as jest.Mock).mockClear();
  mockNavigate.mockClear();
});

it('names the route names a restore dropped beside the restored line', () => {
  showRestoreNotice({ notRestored: 0, namesNotRestored: 19, exportHomeLeftOut: false }, t);
  expect(shownMessage().split('\n')).toEqual([
    'backup.recordRestored',
    'backup.namesNotRestored:{"count":19}',
  ]);
});

it('names the history a restore dropped beside the restored line', () => {
  showRestoreNotice({ notRestored: 26, namesNotRestored: 0, exportHomeLeftOut: false }, t);
  expect(shownMessage().split('\n')).toEqual([
    'backup.recordRestored',
    'backup.historyNotRestored:{"count":26}',
  ]);
});

it('names both drops when a restore made both', () => {
  showRestoreNotice({ notRestored: 1, namesNotRestored: 2, exportHomeLeftOut: false }, t);
  expect(shownMessage().split('\n')).toEqual([
    'backup.recordRestored',
    'backup.namesNotRestored:{"count":2}',
    'backup.historyNotRestored:{"count":1}',
  ]);
});

it('shows the restored line alone when nothing was dropped', () => {
  showRestoreNotice({ notRestored: 0, namesNotRestored: 0, exportHomeLeftOut: false }, t);
  expect(shownMessage()).toBe('backup.recordRestored');
  expect(shown().action).toBeUndefined();
});

it('says the home has to be set again when the file left it out, and opens its setting', () => {
  showRestoreNotice({ notRestored: 3, namesNotRestored: 0, exportHomeLeftOut: true }, t);
  expect(shownMessage().split('\n')).toEqual([
    'backup.recordRestored',
    'backup.historyNotRestored:{"count":3}',
    'backup.exportHomeLeftOut',
  ]);
  expect(shown().action?.label).toBe('backup.setExportHome');
  shown().action?.onPress();
  expect(mockNavigate).toHaveBeenCalledWith('/backup-settings');
});

it('says a held backup waits for sign-in', () => {
  showRestoreNotice('held', t);
  expect(shownMessage()).toBe('backup.heldUntilSignIn');
});
