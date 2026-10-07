/**
 * Scenario: an activity is uploaded and the worker pushes to every registered
 * device. On Android the FCM SDK draws a visible push itself while the app is
 * in the background, before any code of ours runs.
 *
 * Expected behaviour: an Android token gets the silent data push alone. The
 * native worker posts the enriched entry under its own `activity-<id>` tag and
 * cannot replace the placeholder, so a visible push to Android leaves two
 * entries in the tray for one ride. iOS keeps the visible push: its service
 * extension rewrites it in place, and a silent push does not wake a force-quit
 * app there.
 */

import { buildPushMessages } from '../../../oauth-proxy/src/pushMessages';

const TOKEN = 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]';
const VISIBLE = { title: 'Activity recorded', body: 'New activity received' };

function messages(platform?: string) {
  return buildPushMessages(TOKEN, { activity_id: 'a-1' }, VISIBLE, platform);
}

describe('the placeholder the server sends', () => {
  it('sends an Android token the silent push alone', () => {
    const sent = messages('android');
    expect(sent).toHaveLength(1);
    expect(sent[0]._contentAvailable).toBe(true);
  });

  it('carries no title or body to Android, which is what the OS would draw', () => {
    for (const message of messages('android')) {
      expect(message.title).toBeUndefined();
      expect(message.body).toBeUndefined();
    }
  });

  it('still sends iOS both, since the extension rewrites the visible one', () => {
    const sent = messages('ios');
    expect(sent).toHaveLength(2);
    expect(sent[0].title).toBe(VISIBLE.title);
    expect(sent[1]._contentAvailable).toBe(true);
  });

  it('keeps the silent push identical on Android to what it was', () => {
    const silent = messages('android')[0];
    expect(silent).toEqual({
      to: TOKEN,
      data: { activity_id: 'a-1' },
      priority: 'high',
      _contentAvailable: true,
    });
  });

  it('sends an unknown platform the silent push alone', () => {
    const sent = messages(undefined);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toEqual({
      to: TOKEN,
      data: { activity_id: 'a-1' },
      priority: 'high',
      _contentAvailable: true,
    });
  });
});
