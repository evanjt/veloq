/**
 * Scenario: an activity screen opens on a body that is already stored.
 *
 * Expected behaviour: the lighter row the list sync wrote still asks for the
 * detail, and a detail body already on the device does not. Getting this
 * wrong either re-downloads a stored body on every mount or never fetches the
 * detail at all, so the discriminator is pinned here against both shapes.
 */
import { hasDetailBody } from '@/features/activity/lib/engineActivityBody';

/**
 * The fields `ACTIVITY_FIELDS` asks for, as intervals.icu returned them for a
 * run on 2026-09-12. The ones the activity had nothing for are absent, which
 * is why a key count cannot be the test.
 */
const listBody = {
  id: 'i185663341',
  name: 'Morning Run',
  type: 'Run',
  start_date_local: '2026-09-11T07:12:00',
  moving_time: 2400,
  elapsed_time: 2500,
  distance: 8000,
  total_elevation_gain: 120,
  average_speed: 3.3,
  max_speed: 4.9,
  average_heartrate: 152,
  average_cadence: 84,
  calories: 520,
  icu_training_load: 61,
  has_weather: true,
  average_weather_temp: 14,
  icu_ftp: 250,
  stream_types: ['time', 'latlng'],
  skyline_chart_bytes: 'AAAA',
};

const detailBody = { ...listBody, icu_athlete_id: 'i350768', created: '2026-09-11T16:33:12.0' };

describe('hasDetailBody', () => {
  it('says no to the lighter row the list sync wrote', () => {
    expect(hasDetailBody(listBody)).toBe(false);
  });

  it('says yes to a body that came from the detail endpoint', () => {
    expect(hasDetailBody(detailBody)).toBe(true);
  });

  it('says no when nothing is stored', () => {
    expect(hasDetailBody(null)).toBe(false);
    expect(hasDetailBody(undefined)).toBe(false);
  });

  it('says no to a row whose athlete id is empty or of the wrong type', () => {
    expect(hasDetailBody({ ...listBody, icu_athlete_id: '' })).toBe(false);
    expect(hasDetailBody({ ...listBody, icu_athlete_id: 350768 })).toBe(false);
    expect(hasDetailBody({ ...listBody, icu_athlete_id: null })).toBe(false);
  });

  it('says no to something that is not an object at all', () => {
    expect(hasDetailBody('i350768')).toBe(false);
    expect(hasDetailBody(7)).toBe(false);
  });
});
