/**
 * Scenario: the recording bar draws one main button, and its fill says what
 * pressing it does.
 * Expected behaviour: Start and Resume begin recording and take the record
 * role; Pause, Review and the manual Save are actions and take the action role.
 */

import { mainButtonRole } from '@/features/recording/lib/mainButtonRole';

describe('mainButtonRole', () => {
  it.each([
    ['idle', 'gps'],
    ['paused', 'gps'],
    ['idle', 'indoor'],
    ['paused', 'indoor'],
  ] as const)(
    'gives the record role to the button that begins recording, %s %s',
    (status, mode) => {
      expect(mainButtonRole(status, mode)).toBe('record');
    }
  );

  it.each([
    ['recording', 'gps'],
    ['stopped', 'gps'],
    ['recording', 'indoor'],
    ['stopped', 'indoor'],
  ] as const)('gives the action role to Pause and Review, %s %s', (status, mode) => {
    expect(mainButtonRole(status, mode)).toBe('action');
  });

  it.each(['idle', 'recording', 'paused', 'stopped'] as const)(
    'gives the action role to the manual Save whatever the status, %s',
    (status) => {
      expect(mainButtonRole(status, 'manual')).toBe('action');
    }
  );
});
