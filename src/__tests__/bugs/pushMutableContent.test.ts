/**
 * Scenario: the worker sends two pushes per device, a visible one the OS draws
 * and a silent one that wakes the background task.
 *
 * Expected behaviour: the visible one carries `mutableContent`. APNs never
 * invokes a Notification Service Extension without it, and on iOS that
 * extension is the only thing woken deterministically by a visible push, a
 * force-quit included. Without the field every native iOS enrichment path is
 * unreachable, and it fails as "the extension never ran" with nothing naming
 * the cause.
 */

import { buildPushMessages } from '../../../oauth-proxy/src/pushMessages';

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const VISIBLE = { title: 'Activity recorded', body: 'New activity received' };

function messages(platform?: string, visible = VISIBLE as typeof VISIBLE | null) {
  return buildPushMessages(TOKEN, { activity_id: 'a-1' }, visible, platform);
}

describe('the messages one device gets', () => {
  it('marks the visible push mutable, so an iOS extension can rewrite it', () => {
    const [visible] = messages('ios');
    expect(visible.mutableContent).toBe(true);
  });

  it('marks it mutable on Android too, where the field is simply ignored', () => {
    const [visible] = messages('android');
    expect(visible.mutableContent).toBe(true);
  });

  it('leaves the silent push alone: a mutable content-available push is not a thing', () => {
    const sent = messages('ios');
    const silent = sent[sent.length - 1];
    expect(silent._contentAvailable).toBe(true);
    expect(silent.mutableContent).toBeUndefined();
  });

  it('sends only the silent push when there is no visible content', () => {
    const sent = messages('ios', null);
    expect(sent).toHaveLength(1);
    expect(sent[0]._contentAvailable).toBe(true);
  });

  it('keeps the silent push free of anything that would make it a notification', () => {
    const sent = messages('android');
    const silent = sent[sent.length - 1];
    for (const field of ['title', 'body', 'channelId', 'sound']) {
      expect(silent[field]).toBeUndefined();
    }
  });

  it('drops the silent push to normal priority on iOS, which APNs requires', () => {
    expect(messages('ios').at(-1)?.priority).toBe('normal');
    expect(messages('android').at(-1)?.priority).toBe('high');
  });

  it('carries the deep link on the visible push, so a tap lands on the activity', () => {
    const [visible] = messages('android');
    expect(visible.data).toMatchObject({ activityId: 'a-1', route: '/activity/a-1' });
  });

  it('omits the deep link when the event names no activity', () => {
    const [visible] = buildPushMessages(TOKEN, {}, VISIBLE, 'android');
    expect(visible.data).toEqual({});
  });
});
