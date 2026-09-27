/**
 * Scenario: the sync line names the endpoint the engine is on. The engine
 * reports the step as a token and the bundle turns it into a line, for the
 * same reason the failure reason is handled that way.
 *
 * Expected behaviour: every step the engine can report has a real translation
 * in every locale, and the line that carries the step counts keeps
 * its placeholders. A missing one leaves an athlete reading a raw key.
 */

import * as fs from 'fs';
import * as path from 'path';

import { SyncStep } from '../__shared__/veloqrsStub';

const LOCALES_DIR = path.join(__dirname, '../../i18n/locales');

const KEYS = [
  'athlete',
  'sportSettings',
  'wellness',
  'census',
  'activities',
  'firstActivities',
  'curves',
  'intervalBodies',
  'remainingActivities',
] as const;

const ENGLISH_LOCALES = ['en-AU', 'en-GB', 'en-US'];

const locales = fs
  .readdirSync(LOCALES_DIR)
  .filter((f) => f.endsWith('.json'))
  .map((f) => f.replace('.json', ''));

function settingsOf(locale: string): Record<string, unknown> {
  const raw = fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), 'utf-8');
  return JSON.parse(raw).settings as Record<string, unknown>;
}

function stepsOf(locale: string): Record<string, string> {
  return settingsOf(locale).syncStep as Record<string, string>;
}

describe('sync step strings', () => {
  it('has a key for every step the engine can report', () => {
    const members = Object.values(SyncStep).filter((v) => typeof v === 'number');
    expect(KEYS).toHaveLength(members.length);
  });

  /** The defect: the counters count steps, and the line called them activities. */
  it('counts steps without calling them activities', () => {
    const english = settingsOf('en-GB');
    expect(english.syncActivitiesProgress).toBeUndefined();
    expect(english.syncStepProgress).toBe('{{label}} ({{completed}} of {{total}})');
  });

  /** Every English line says whose data the step is fetching, not just what. */
  it.each(ENGLISH_LOCALES)('%s names whose data each step fetches', (locale) => {
    const steps = stepsOf(locale);
    const impersonal = KEYS.filter((k) => !steps[k].includes('your'));
    expect(impersonal).toEqual([]);
  });

  describe.each(locales)('%s', (locale) => {
    const steps = stepsOf(locale);
    const progress = settingsOf(locale).syncStepProgress as string;

    it('names no step the engine cannot report', () => {
      expect(Object.keys(steps).sort()).toEqual([...KEYS].sort());
    });

    it('keeps the placeholders of the step count', () => {
      for (const placeholder of ['{{label}}', '{{completed}}', '{{total}}']) {
        expect(progress).toContain(placeholder);
      }
    });

    /**
     * The defect: "Checking what is missing" named nothing and read as a
     * fault. Every locale's census line says what it lists and where from.
     */
    it('names the source the census lists', () => {
      expect(steps.census).toContain('intervals.icu');
    });
  });
});
