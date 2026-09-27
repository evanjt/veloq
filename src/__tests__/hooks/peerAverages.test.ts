/**
 * Scenario: peer-comparison chips average the same activity type from history.
 *
 * Expected behaviour: activities missing the field are excluded, not counted as
 * zero. Twenty rides where eight lack a heart-rate strap must average the twelve
 * that have one, or an ordinary ride reads as far above typical.
 */
import { peerAverages } from '@/features/activity/components/stats/peerAverages';
import type { Activity } from '@/types';

function ride(fields: Partial<Activity>): Activity {
  return { id: 'i1', type: 'Ride', ...fields } as Activity;
}

describe('peer averages', () => {
  const history: Activity[] = [
    ...Array.from({ length: 12 }, () => ride({ average_heartrate: 140 })),
    ...Array.from({ length: 8 }, () => ride({ average_heartrate: null as never })),
  ];

  it('averages only the activities carrying the field', () => {
    expect(peerAverages(history, 'Ride').avgHR).toBe(140);
  });

  it('falls back to the intervals.icu heart rate when the device carried none', () => {
    const rows = [ride({ average_heartrate: 150 }), ride({ icu_average_hr: 130 })];
    expect(peerAverages(rows, 'Ride').avgHR).toBe(140);
  });

  it('averages load and intensity each over their own carriers', () => {
    const rows = [
      ride({ icu_training_load: 80, icu_intensity: 70 }),
      ride({ icu_training_load: 40 }),
      ride({}),
    ];
    const averages = peerAverages(rows, 'Ride');
    expect(averages.avgLoad).toBe(60);
    expect(averages.avgIntensity).toBe(70);
  });

  it('compares against the same sport only', () => {
    const rows = [...history, { ...ride({ average_heartrate: 170 }), type: 'Run' } as Activity];
    expect(peerAverages(rows, 'Ride').avgHR).toBe(140);
    expect(peerAverages(rows, 'Run').avgHR).toBe(170);
  });

  it('returns null when nothing carries the field, so the chip disappears', () => {
    const none = [ride({ average_heartrate: null as never }), ride({})];
    expect(peerAverages(none, 'Ride').avgHR).toBeNull();
  });

  it('returns null for every average when no activity shares the type', () => {
    expect(peerAverages(history, 'Swim')).toEqual({
      avgLoad: null,
      avgIntensity: null,
      avgHR: null,
    });
  });
});
