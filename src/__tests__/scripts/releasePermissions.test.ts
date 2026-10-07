import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { addBlockedPermissions } = require('@expo/config-plugins/build/android/Permissions');

it('removes overlay and microphone permission requests in the generated release manifest', () => {
  const app = JSON.parse(readFileSync(resolve(__dirname, '../../../app.json'), 'utf8'));
  const manifest = {
    manifest: {
      $: {},
      'uses-permission': [
        { $: { 'android:name': 'android.permission.SYSTEM_ALERT_WINDOW' } },
        { $: { 'android:name': 'android.permission.RECORD_AUDIO' } },
      ],
    },
  };
  const result = addBlockedPermissions(manifest, app.expo.android.blockedPermissions ?? []);
  for (const permission of ['SYSTEM_ALERT_WINDOW', 'RECORD_AUDIO']) {
    expect(result.manifest['uses-permission']).toContainEqual({
      $: { 'android:name': `android.permission.${permission}`, 'tools:node': 'remove' },
    });
  }
});
