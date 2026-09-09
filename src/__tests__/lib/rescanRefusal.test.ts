/**
 * Scenario: the engine refuses a rescan and the screen has to say why.
 *
 * Expected behaviour: every verdict the engine can answer with maps to a line,
 * a started run maps to none, and no verdict falls through to silence, which
 * is what the screen did with all of them before.
 */

import { StartOutcome } from 'veloqrs';
import { rescanRefusalKey } from '@/features/routes/lib/rescanRefusal';
import enAu from '@/i18n/locales/en-AU.json';

jest.mock('veloqrs', () => require('../__shared__/veloqrsStub').withOverrides());

const REFUSALS = [
  StartOutcome.Busy,
  StartOutcome.Held,
  StartOutcome.NotReady,
  StartOutcome.NotConfigured,
  StartOutcome.NotOwed,
  StartOutcome.Failed,
] as const;

test('a run that started says nothing', () => {
  expect(rescanRefusalKey(StartOutcome.Started)).toBeNull();
  expect(rescanRefusalKey(null)).toBeNull();
});

test('every refusal names a line, and every line exists', () => {
  const keys = REFUSALS.map((outcome) => rescanRefusalKey(outcome));
  expect(keys.every((key) => key !== null)).toBe(true);

  const strings = enAu as unknown as Record<string, Record<string, string>>;
  for (const key of keys) {
    const [namespace, name] = (key as string).split('.');
    expect(typeof strings[namespace]?.[name]).toBe('string');
  }
});

test('the reasons that lift and the ones that do not read differently', () => {
  expect(rescanRefusalKey(StartOutcome.NotConfigured)).not.toBe(
    rescanRefusalKey(StartOutcome.Held)
  );
  expect(rescanRefusalKey(StartOutcome.Busy)).not.toBe(rescanRefusalKey(StartOutcome.Held));
});
