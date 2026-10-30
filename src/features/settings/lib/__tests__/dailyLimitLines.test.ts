/**
 * Scenario: the engine's governor reports 120 of the day's 650 backfill
 * requests drawn and a reset an hour from now.
 *
 * Expected behaviour: the sync settings show today's figure with the local
 * reset time beside it, taken from the engine and never from a constant.
 */

import type { TFunction } from 'i18next';

import { dailyLimitLines } from '../dailyLimitLines';

const t = ((key: string, opts?: Record<string, unknown>) =>
  opts ? `${key}:${JSON.stringify(opts)}` : key) as unknown as TFunction;

const clock = (epochMs: number) => `clock@${epochMs}`;

describe('dailyLimitLines', () => {
  it('carries the used and allowed counts and the reset the engine gave', () => {
    const lines = dailyLimitLines({ used: 120, perDay: 650, resetsAtMs: 1_000 }, t, clock)!;

    expect(lines.today).toBe('settings.dailyLimitToday:{"used":120,"limit":650}');
    expect(lines.reset).toBe('settings.dailyLimitResets:{"time":"clock@1000"}');
    expect(lines.shared).toBe('settings.dailyLimitShared');
  });

  it('shows a day with nothing drawn as zero, not as absent', () => {
    const lines = dailyLimitLines({ used: 0, perDay: 650, resetsAtMs: 1_000 }, t, clock)!;

    expect(lines.today).toBe('settings.dailyLimitToday:{"used":0,"limit":650}');
  });

  it('shows nothing where the engine reports no daily limit', () => {
    expect(dailyLimitLines(null, t, clock)).toBeNull();
    expect(dailyLimitLines(undefined, t, clock)).toBeNull();
  });
});
