/**
 * Scenario: a screen reader reads a value's accessible name as written, so a
 * duration printed '1:30' is spoken as a clock time, a pace as a ratio, and an
 * up arrow as "up arrow" even when the pace it marks fell.
 *
 * Expected behaviour: each visual formatter has a spoken twin that says the
 * same quantity in words, with the absent mark spoken as no value, and a
 * trend glyph is spoken as the judgement it draws.
 */

import { initialiseI18n } from '@/i18n';
import { formatCalories, formatDistance, formatElevation, formatPace } from '@/shared/format';
import {
  spokenDistance,
  spokenDuration,
  spokenElevation,
  spokenPace,
  spokenSwimPace,
  spokenVerdict,
} from '@/shared/format/spoken';

beforeAll(async () => {
  await initialiseI18n('en-GB');
});

describe('spokenDuration', () => {
  it('says a time under a minute in seconds alone', () => {
    expect(spokenDuration(45)).toBe('45 seconds');
    expect(spokenDuration(1)).toBe('1 second');
  });

  it('says exactly an hour without the zero parts', () => {
    expect(spokenDuration(3600)).toBe('1 hour');
  });

  it('says every non-zero part of a long time', () => {
    expect(spokenDuration(3665)).toBe('1 hour 1 minute 5 seconds');
    expect(spokenDuration(90)).toBe('1 minute 30 seconds');
    expect(spokenDuration(7200 + 120)).toBe('2 hours 2 minutes');
  });

  it('says zero as zero seconds rather than nothing', () => {
    expect(spokenDuration(0)).toBe('0 seconds');
  });

  it.each([NaN, Infinity, -1, null, undefined])('says no value for %p', (input) => {
    expect(spokenDuration(input as number)).toBe('no value');
  });
});

describe('spokenPace', () => {
  it('says the metric pace per kilometre with the same minutes and seconds the screen shows', () => {
    expect(formatPace(3.0, true)).toBe('5:33 /km');
    expect(spokenPace(3.0, true)).toBe('5 minutes 33 seconds per kilometre');
  });

  it('says the imperial pace per mile', () => {
    expect(formatPace(3.0, false)).toBe('8:56 /mi');
    expect(spokenPace(3.0, false)).toBe('8 minutes 56 seconds per mile');
  });

  it('carries a rounded 60 seconds into the minute, as the screen does', () => {
    // 1000 / 3.3378 = 299.6 s, which the screen prints as 5:00.
    expect(formatPace(3.3378, true)).toBe('5:00 /km');
    expect(spokenPace(3.3378, true)).toBe('5 minutes per kilometre');
  });

  it.each([0, -2, NaN, Infinity, 1e-12])('says no value where the screen shows --:-- (%p)', (v) => {
    expect(formatPace(v, true)).toBe('--:--');
    expect(spokenPace(v, true)).toBe('no value');
  });
});

describe('spokenSwimPace', () => {
  it('says the pace per 100 metres or per 100 yards', () => {
    expect(spokenSwimPace(1.25, true)).toBe('1 minute 20 seconds per 100 metres');
    expect(spokenSwimPace(1.25, false)).toBe('1 minute 13 seconds per 100 yards');
    expect(spokenSwimPace(0, true)).toBe('no value');
  });
});

describe('spokenDistance', () => {
  it('says the same quantity the screen shows, with the unit in words', () => {
    expect(formatDistance(500, true)).toBe('500 m');
    expect(spokenDistance(500, true)).toBe('500 metres');
    expect(formatDistance(1500, true)).toBe('1.5 km');
    expect(spokenDistance(1500, true)).toBe('1.5 kilometres');
    expect(formatDistance(1500, false)).toBe('0.9 mi');
    expect(spokenDistance(1500, false)).toBe('0.9 miles');
    expect(spokenDistance(100, false)).toBe('328 feet');
  });

  it('takes the singular at one', () => {
    expect(spokenDistance(1, true)).toBe('1 metre');
    expect(spokenDistance(1000, true)).toBe('1 kilometre');
  });

  it.each([NaN, -1, null, undefined])('says no value for %p', (input) => {
    expect(spokenDistance(input as number, true)).toBe('no value');
  });
});

describe('spokenElevation', () => {
  it('says metres or feet in words', () => {
    expect(formatElevation(120, true)).toBe('120 m');
    expect(spokenElevation(120, true)).toBe('120 metres');
    expect(formatElevation(120, false)).toBe('394 ft');
    expect(spokenElevation(120, false)).toBe('394 feet');
    expect(spokenElevation(-3, true)).toBe('-3 metres');
  });

  it.each([NaN, null, undefined])('says no value for %p rather than zero', (input) => {
    expect(spokenElevation(input as number, true)).toBe('no value');
  });
});

describe('spokenVerdict', () => {
  it('says the judgement, not the direction', () => {
    expect(spokenVerdict('improved', 'down')).toBe('improved');
    expect(spokenVerdict('declined', 'up')).toBe('declined');
    expect(spokenVerdict('flat', 'flat')).toBe('no change');
  });

  it('says the bare direction for a move with no judgement', () => {
    expect(spokenVerdict('moved', 'up')).toBe('rose');
    expect(spokenVerdict('moved', 'down')).toBe('fell');
  });
});

describe('formatCalories', () => {
  it('prints kcal, the unit every other energy figure uses', () => {
    expect(formatCalories(820)).toBe('820 kcal');
  });

  it('prints the whole number rather than a k abbreviation', () => {
    const out = formatCalories(1234);
    expect(out).not.toMatch(/\dk\b/);
    expect(out.replace(/\D/g, '')).toBe('1234');
    expect(out.endsWith(' kcal')).toBe(true);
  });
});
