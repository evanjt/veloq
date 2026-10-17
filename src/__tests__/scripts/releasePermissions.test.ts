import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const { addBlockedPermissions } = require('expo/config-plugins').AndroidConfig.Permissions;

const BLOCKED = [
  'SYSTEM_ALERT_WINDOW',
  'RECORD_AUDIO',
  'READ_EXTERNAL_STORAGE',
  'WRITE_EXTERNAL_STORAGE',
];

it('removes overlay, microphone and legacy storage permission requests in the generated release manifest', () => {
  const app = JSON.parse(readFileSync(resolve(__dirname, '../../../app.json'), 'utf8'));
  const manifest = {
    manifest: {
      $: {},
      'uses-permission': BLOCKED.map((permission) => ({
        $: { 'android:name': `android.permission.${permission}` },
      })),
    },
  };
  const result = addBlockedPermissions(manifest, app.expo.android.blockedPermissions ?? []);
  for (const permission of BLOCKED) {
    expect(result.manifest['uses-permission']).toContainEqual({
      $: { 'android:name': `android.permission.${permission}`, 'tools:node': 'remove' },
    });
  }
});
