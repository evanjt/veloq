/**
 * Scenario: a fresh install, partway through its first sync, with nothing
 * stored yet.
 *
 * Expected behaviour: the feed says what is happening in the athlete's own
 * language and names the endpoint the engine is on. That line appears only
 * once the engine reports a step, because the counters beside it count steps
 * and a bare fraction of them says less than nothing.
 */

import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen } from '@testing-library/react-native';
import { SyncStep } from 'veloqrs';

import en from '@/i18n/locales/en-AU.json';
import { FeedFirstSyncStandby } from '@/features/home/components/FeedFirstSyncStandby';

jest.mock('veloqrs', () => require('../../__shared__/veloqrsStub'));

/** `t` answers with the key and its variables, so both are assertable. */
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, vars?: Record<string, unknown>) =>
      vars ? `${key}:${JSON.stringify(vars)}` : key,
  }),
}));

let mockStatus: {
  state: number;
  completed: number;
  total: number;
  step?: SyncStep;
} | null = null;
jest.mock('@/shared/native/useSyncStatus', () => ({
  useSyncStatus: () => mockStatus,
}));

const LOCALES = path.join(__dirname, '../../../i18n/locales');
const KEYS = ['feed.firstSyncTitle', 'feed.firstSyncBody'];

function lookup(bundle: Record<string, unknown>, key: string): unknown {
  return key.split('.').reduce<unknown>((acc, part) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[part];
    return undefined;
  }, bundle);
}

describe('the first-sync standby', () => {
  beforeEach(() => {
    mockStatus = { state: 1, completed: 0, total: 0 };
  });

  it('says what is happening rather than that there is nothing', () => {
    render(<FeedFirstSyncStandby />);

    expect(screen.getByTestId('feed-first-sync-title')).toBeTruthy();
    expect(screen.getByTestId('feed-first-sync-body')).toBeTruthy();
  });

  it('draws no step line before the engine reports a step', () => {
    render(<FeedFirstSyncStandby />);

    expect(screen.queryByTestId('feed-first-sync-step')).toBeNull();
  });

  /** The defect: a step count read as a count of activities, so a fresh
   *  install waiting on the athlete profile said "0 of 7 activities". */
  it('names the endpoint the engine is on rather than counting activities', () => {
    mockStatus = { state: 1, completed: 0, total: 8, step: SyncStep.Athlete };
    render(<FeedFirstSyncStandby />);

    const line = screen.getByTestId('feed-first-sync-step').props.children;
    expect(line).toBe(
      'settings.syncStepProgress:{"label":"settings.syncStep.athlete","completed":0,"total":8}'
    );
  });

  it('follows the engine to the step that carries the activities', () => {
    mockStatus = { state: 1, completed: 4, total: 8, step: SyncStep.Activities };
    render(<FeedFirstSyncStandby />);

    expect(screen.getByTestId('feed-first-sync-step').props.children).toBe(
      'settings.syncStepProgress:{"label":"settings.syncStep.activities","completed":4,"total":8}'
    );
  });

  it('survives a status the engine has not answered yet', () => {
    mockStatus = null;
    render(<FeedFirstSyncStandby />);

    expect(screen.getByTestId('feed-first-sync-standby')).toBeTruthy();
    expect(screen.queryByTestId('feed-first-sync-step')).toBeNull();
  });

  it.each(KEYS)('%s is in en-AU', (key) => {
    expect(typeof lookup(en as Record<string, unknown>, key)).toBe('string');
  });

  it('carries both lines in every locale, so no one reads English here alone', () => {
    const files = fs.readdirSync(LOCALES).filter((f) => f.endsWith('.json'));
    expect(files.length).toBeGreaterThan(10);

    const missing: string[] = [];
    for (const file of files) {
      const bundle = JSON.parse(fs.readFileSync(path.join(LOCALES, file), 'utf8'));
      for (const key of KEYS) {
        if (typeof lookup(bundle, key) !== 'string') missing.push(`${file}:${key}`);
      }
    }
    expect(missing).toEqual([]);
  });
});
