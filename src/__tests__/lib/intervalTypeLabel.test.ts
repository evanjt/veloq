/**
 * Scenario: an athlete who plans a structured workout on the website names its
 * intervals, and the table rendered the zone number instead. On the measured
 * account five of 455 intervals carry a label, all on one structured run, and
 * two of the five sit at the same zone, so the label is the only thing that
 * separates the warm up from the interval it precedes.
 *
 * Expected behaviour: the athlete's own words win where they exist, and the
 * zone token stays where they do not. The zone still decides the colour, which
 * the label never carries.
 */

import { intervalTypeLabel } from '@/features/activity/lib/intervalTypeLabel';
import { initialiseI18n } from '@/i18n';
import { IntervalKind } from 'veloqrs';

describe('intervalTypeLabel', () => {
  beforeAll(async () => {
    await initialiseI18n('en-GB');
  });

  it('shows the athlete words over the zone token', () => {
    expect(
      intervalTypeLabel({
        kind: IntervalKind.Work,
        zone: 4,
        label: '2km at 6:00/km',
        zoneColoured: true,
      })
    ).toBe('2km at 6:00/km');
  });

  it('separates two intervals that share a zone', () => {
    const warmUp = intervalTypeLabel({
      kind: IntervalKind.Work,
      zone: 6,
      label: '1.5km warm up',
      zoneColoured: true,
    });
    const effort = intervalTypeLabel({
      kind: IntervalKind.Work,
      zone: 6,
      label: '1km at 5:50/km',
      zoneColoured: true,
    });

    expect(warmUp).not.toBe(effort);
  });

  it('keeps the zone token when there is no label', () => {
    expect(
      intervalTypeLabel({ kind: IntervalKind.Work, zone: 4, label: null, zoneColoured: true })
    ).toBe('Z4');
    expect(intervalTypeLabel({ kind: IntervalKind.Work, zone: 4, zoneColoured: true })).toBe('Z4');
  });

  it('falls back rather than rendering a blank cell', () => {
    expect(
      intervalTypeLabel({ kind: IntervalKind.Work, zone: 4, label: '', zoneColoured: true })
    ).toBe('Z4');
    expect(
      intervalTypeLabel({ kind: IntervalKind.Work, zone: 4, label: '   ', zoneColoured: true })
    ).toBe('Z4');
  });

  it('labels a work interval with no zone colour, as it did before', () => {
    expect(intervalTypeLabel({ kind: IntervalKind.Work, zone: null, zoneColoured: false })).toBe(
      'Work'
    );
    expect(
      intervalTypeLabel({
        kind: IntervalKind.Work,
        zone: null,
        label: 'openers',
        zoneColoured: false,
      })
    ).toBe('openers');
  });

  it('names recovery and rest the way the table already does', () => {
    expect(
      intervalTypeLabel({ kind: IntervalKind.Recovery, zone: null, zoneColoured: false })
    ).toBe('Rec');
    expect(intervalTypeLabel({ kind: IntervalKind.Rest, zone: null, zoneColoured: false })).toBe(
      'Rec'
    );
  });

  it('lets an athlete name a recovery interval too', () => {
    expect(
      intervalTypeLabel({
        kind: IntervalKind.Recovery,
        zone: null,
        label: 'jog back',
        zoneColoured: false,
      })
    ).toBe('jog back');
  });

  it('names a warm up and a cool down from the locale, never by the raw type', () => {
    expect(intervalTypeLabel({ kind: IntervalKind.Warmup, zone: null, zoneColoured: false })).toBe(
      'WU'
    );
    expect(
      intervalTypeLabel({ kind: IntervalKind.Cooldown, zone: null, zoneColoured: false }, 'long')
    ).toBe('Cool-down');
  });

  it('trims the athlete words rather than rendering their padding', () => {
    expect(
      intervalTypeLabel({
        kind: IntervalKind.Work,
        zone: 4,
        label: '  1.5km cool down  ',
        zoneColoured: true,
      })
    ).toBe('1.5km cool down');
  });
});
