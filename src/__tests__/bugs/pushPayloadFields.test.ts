/**
 * Scenario: the worker builds the data object every device receives, which
 * passes through Expo and, on iOS, Apple.
 *
 * Expected behaviour: it holds exactly the event type, the athlete id the
 * device checks against its signed-in athlete, and the activity id. No send
 * timestamp or other field rides along, because the privacy page lists what
 * the push carries.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { buildPushMessages, pushDataFor } from '../../../oauth-proxy/src/pushMessages';

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const EVENT = { type: 'ACTIVITY_UPLOADED', athlete_id: 'i123', activity: { id: 'a-1' } };

describe('the push data', () => {
  it('holds only the event type, athlete id and activity id', () => {
    expect(Object.keys(pushDataFor(EVENT)).sort()).toEqual([
      'activity_id',
      'athlete_id',
      'event_type',
    ]);
  });

  it('carries a null activity id when the event has no activity', () => {
    expect(pushDataFor({ type: 'X', athlete_id: 'i123' }).activity_id).toBeNull();
  });

  it('adds only the tap keys to the iOS visible push and nothing to the silent one', () => {
    const data = pushDataFor(EVENT);
    const [visible, silent] = buildPushMessages(TOKEN, data, { title: 't', body: 'b' }, 'ios');
    expect(Object.keys(visible.data as object).sort()).toEqual([
      'activityId',
      'activity_id',
      'athlete_id',
      'event_type',
      'route',
    ]);
    expect(Object.keys(silent.data as object).sort()).toEqual([
      'activity_id',
      'athlete_id',
      'event_type',
    ]);
  });
});

describe('the privacy page', () => {
  const page = readFileSync(join(__dirname, '../../../docs/privacy/index.html'), 'utf8');
  const athleteWord: Record<string, RegExp> = {
    en: /athlete ID/,
    es: /ID de atleta/,
    fr: /ID d'athlète/,
  };
  const pushListKeys = ['thirdParty.expo.item2', 'pushNotifications.howItWorks.item2'];

  it('names the athlete id in every sentence that lists what the push carries', () => {
    const sentences = pushListKeys.flatMap((key) => {
      const markup = page.match(new RegExp(`data-i18n="${key}">([^<]*)<`));
      const table = [...page.matchAll(new RegExp(`"${key}": "((?:[^"\\\\]|\\\\.)*)"`, 'g'))];
      return [markup?.[1], ...table.map((m) => m[1])].map((text) => ({ key, text }));
    });
    expect(sentences).toHaveLength(pushListKeys.length * 4);
    for (const { key, text } of sentences) {
      expect({
        key,
        text,
        named: Object.values(athleteWord).some((re) => re.test(text ?? '')),
      }).toEqual({
        key,
        text,
        named: true,
      });
    }
  });
});
