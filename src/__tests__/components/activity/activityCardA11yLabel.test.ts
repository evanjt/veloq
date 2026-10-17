/**
 * Scenario: a feed card is one screen reader element, so its label is all a
 * screen reader user hears of it.
 *
 * Expected behaviour: the label carries every figure the card draws, each unit
 * once, the record and trend counts and the route delta, and never a figure
 * the card hides.
 */

import { changeLanguage, i18n, initialiseI18n } from '@/i18n';
import {
  activityCardA11yLabel,
  activitySecondaryStatLabels,
} from '@/features/activity/lib/activityCardA11yLabel';
import type { Activity } from '@/types';

const t = i18n.t.bind(i18n);

beforeAll(async () => {
  await initialiseI18n();
  await changeLanguage('en-GB');
});

const activity = {
  id: 'a1',
  name: 'Quarry hill repeats',
  type: 'Ride',
  start_date_local: '2026-08-12T07:30:00',
  distance: 42000,
  moving_time: 5400,
  total_elevation_gain: 359,
  average_heartrate: 142,
  icu_average_watts: 230,
  stream_types: ['latlng'],
} as Activity;

const occurrences = (text: string, part: string) => text.split(part).length - 1;

describe('activityCardA11yLabel', () => {
  it('speaks the climb, each stat with its unit once, the PR count and the route gain', () => {
    const label = activityCardA11yLabel(
      {
        activity,
        isMetric: true,
        sectionHighlights: [
          { isPr: true, trend: 1 },
          { isPr: true, trend: 0 },
          { isPr: false, trend: -1 },
        ],
        routeHighlight: { isPr: true, trend: 1, prImprovementSeconds: 12 },
      },
      t
    );

    expect(label.startsWith('Quarry hill repeats, ')).toBe(true);
    expect(label).toContain('42 kilometres');
    expect(label).toContain('1 hour 30 minutes');
    expect(label).toContain('359 metres');
    expect(label).toContain('142 bpm');
    expect(occurrences(label, 'bpm')).toBe(1);
    expect(label).toContain('230 W');
    expect(label.match(/\bW\b/g)).toHaveLength(1);
    expect(label).toContain('PRs: 2');
    expect(label).toContain('Slower: 1');
    expect(label).not.toContain('Faster:');
    expect(label).toContain('Personal record by 12 seconds');
  });

  it('speaks how far off the route PR a slower ride was', () => {
    const label = activityCardA11yLabel(
      {
        activity,
        isMetric: true,
        routeHighlight: { isPr: false, trend: -1, timeDeltaSeconds: 75 },
      },
      t
    );
    expect(label).toContain('1 minute 15 seconds off PR');
  });

  it('names the new ground badge the card draws', () => {
    const label = activityCardA11yLabel(
      {
        activity,
        isMetric: true,
        newGround: { badge: 'entirelyNew' },
      },
      t
    );
    expect(label).toContain('New ground');
  });

  it('never speaks a zero distance or climb the card leaves out', () => {
    const indoor = {
      ...activity,
      distance: 0,
      total_elevation_gain: 0,
      stream_types: [],
    } as unknown as Activity;
    const label = activityCardA11yLabel({ activity: indoor, isMetric: true }, t);
    expect(label).not.toMatch(/\b0 (kilo)?metres\b/);
    expect(label).toContain('1 hour 30 minutes');
    expect(label).toContain('142 bpm');
  });

  it('says each secondary stat with the unit its formatter draws, once', () => {
    const full = { ...activity, calories: 812, icu_training_load: 96 } as Activity;
    expect(activitySecondaryStatLabels(full, true, t)).toEqual([
      'Training load: 96',
      'Heart rate: 142 bpm',
      'Power: 230 W',
      'Calories: 812 kcal',
    ]);
  });

  it('gives no stat label for a stat the card does not draw', () => {
    const bare = { ...activity, average_heartrate: undefined, icu_average_watts: undefined };
    expect(activitySecondaryStatLabels(bare as Activity, true, t)).toEqual([]);
  });
});
