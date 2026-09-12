/**
 * Scenario: a sync used to post a sticky tray entry the athlete could not
 * swipe away, on its own LOW-importance channel, for work they did not ask for
 * and do not need to watch. The app reports its own sync on screen.
 *
 * Expected behaviour: nothing in the notification service posts or dismisses a
 * sync entry, and no sync channel is registered, so the machinery that existed
 * only to keep that entry quiet is gone with it.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const service = read('src/features/settings/lib/notificationService.ts');
const globalSync = read('src/shared/app/GlobalDataSync.tsx');

describe('the sync notification is gone', () => {
  it('leaves no poster and no dismisser behind', () => {
    expect(service).not.toMatch(/updateSyncNotification|dismissSyncNotification/);
    expect(globalSync).not.toMatch(/updateSyncNotification|dismissSyncNotification/);
  });

  it('registers no sync channel and names no sync identifier', () => {
    expect(service).not.toContain('veloq-sync');
    expect(service).not.toContain('sync-progress');
  });

  it('drops the branches that existed only to keep it quiet', () => {
    // The banner suppression and the tray-sweep exemption both keyed on the
    // sync identifier. With nothing posting under it, a branch testing for it
    // is dead and a reader has to work out that it can never be taken.
    expect(service).not.toMatch(/SYNC_NOTIFICATION_ID|SYNC_CHANNEL_ID/);
  });

  it('keeps the insight channel, which is what still posts', () => {
    expect(service).toContain('veloq-insights');
  });
});
