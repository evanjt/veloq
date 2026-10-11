/**
 * Scenario: the App Store and Play privacy labels are set by hand in two
 * consoles, from a record in the tree. A permission added to `app.json`, or a
 * console answer changed on one store only, used to leave the labels saying
 * something the app does not do.
 *
 * Expected behaviour: every capability `app.json` grants is declared or listed
 * as not collected with a reason, on each store; both stores declare the same
 * server-held items; an item filed under the athlete is linked on the App
 * Store; and Play's deletion answer is yes whenever the server can delete
 * what it keeps.
 */

import {
  appJsonCarriers,
  loadAppJson,
  loadPrivacyRecord,
  privacyDeclarationGaps,
  type StorePrivacyRecord,
} from '../../../scripts/store-privacy-declarations';

const greenhouseApp = {
  expo: {
    ios: { infoPlist: { UIBackgroundModes: ['remote-notification'] } },
    android: { permissions: ['INTERNET', 'android.permission.POST_NOTIFICATIONS'] },
    plugins: ['./src/plugins/with-greenhouse-sensors', ['expo-notifications', { icon: 'x' }]],
  },
};

const notifyCarriers = [
  'backgroundMode:remote-notification',
  'permission:POST_NOTIFICATIONS',
  'plugin:expo-notifications',
];

function greenhouseRecord(): StorePrivacyRecord {
  const removable = ['turning alerts off', 'expiry after a week'];
  return {
    serverHeld: [
      {
        id: 'growerId',
        what: 'grower account id',
        source: 'server',
        ephemeral: false,
        linkedToAthlete: true,
        deletion: removable,
      },
      {
        id: 'alertToken',
        what: 'alert token',
        source: 'server',
        ephemeral: false,
        linkedToAthlete: true,
        deletion: removable,
      },
      {
        id: 'requestCounter',
        what: 'address counter',
        source: 'server',
        ephemeral: true,
        linkedToAthlete: false,
        deletion: [],
      },
    ],
    noUserData: [{ carriers: ['permission:INTERNET'], note: 'transport only' }],
    appStore: {
      tracking: false,
      dataTypes: [
        {
          category: 'Identifiers',
          type: 'User ID',
          purposes: ['App Functionality'],
          linked: true,
          tracking: false,
          holds: ['growerId'],
          carriers: notifyCarriers,
        },
        {
          category: 'Identifiers',
          type: 'Device ID',
          purposes: ['App Functionality'],
          linked: true,
          tracking: false,
          holds: ['alertToken'],
          carriers: notifyCarriers,
        },
      ],
      notCollected: [],
    },
    play: {
      encryptedInTransit: true,
      deletion: { userCanRequest: true, paths: removable },
      dataTypes: [
        {
          category: 'Personal info',
          type: 'User IDs',
          purposes: ['App functionality'],
          optional: true,
          shared: false,
          ephemeral: false,
          holds: ['growerId'],
          carriers: notifyCarriers,
        },
        {
          category: 'Device or other IDs',
          type: 'Device or other IDs',
          purposes: ['App functionality'],
          optional: true,
          shared: false,
          ephemeral: false,
          holds: ['alertToken'],
          carriers: notifyCarriers,
        },
      ],
      notCollected: [],
    },
  };
}

function withPermission(permission: string) {
  return {
    expo: {
      ...greenhouseApp.expo,
      android: { permissions: [...greenhouseApp.expo.android.permissions, permission] },
    },
  };
}

describe('appJsonCarriers', () => {
  it('names permissions, background modes, prompts and package plugins', () => {
    const app = {
      expo: {
        ios: {
          infoPlist: {
            UIBackgroundModes: ['location'],
            NSCameraUsageDescription: 'scan a seed packet',
            CFBundleDevelopmentRegion: 'en',
          },
        },
        android: { permissions: ['android.permission.CAMERA', 'VIBRATE'] },
        plugins: ['expo-camera', ['expo-location', {}], './src/plugins/with-local-thing'],
      },
    };
    expect(appJsonCarriers(app)).toEqual([
      'backgroundMode:location',
      'permission:CAMERA',
      'permission:VIBRATE',
      'plugin:expo-camera',
      'plugin:expo-location',
      'usageDescription:NSCameraUsageDescription',
    ]);
  });

  it('names nothing for an app.json that grants nothing', () => {
    expect(appJsonCarriers({})).toEqual([]);
    expect(appJsonCarriers({ expo: {} })).toEqual([]);
  });
});

describe('privacyDeclarationGaps', () => {
  it('passes a record that accounts for everything', () => {
    expect(privacyDeclarationGaps(greenhouseApp, greenhouseRecord())).toEqual([]);
  });

  it('refuses a permission added to app.json with no declaration, on both stores', () => {
    expect(privacyDeclarationGaps(withPermission('CAMERA'), greenhouseRecord())).toEqual([
      'appStore: permission:CAMERA is in app.json but neither declared nor listed as not collected',
      'play: permission:CAMERA is in app.json but neither declared nor listed as not collected',
    ]);
  });

  it('refuses a permission accounted for on one store only', () => {
    const record = greenhouseRecord();
    record.appStore.notCollected.push({
      what: 'seed packet scan',
      carriers: ['permission:CAMERA'],
      reason: 'onDevice',
      note: 'read on the device',
    });
    expect(privacyDeclarationGaps(withPermission('CAMERA'), record)).toEqual([
      'play: permission:CAMERA is in app.json but neither declared nor listed as not collected',
    ]);
  });

  it('accepts a permission listed as not collected with a reason', () => {
    const record = greenhouseRecord();
    for (const store of ['appStore', 'play'] as const) {
      record[store].notCollected.push({
        what: 'seed packet scan',
        carriers: ['permission:CAMERA'],
        reason: 'onDevice',
        note: 'read on the device',
      });
    }
    expect(privacyDeclarationGaps(withPermission('CAMERA'), record)).toEqual([]);
  });

  it('refuses a not-collected entry whose reason is none of the three', () => {
    const record = greenhouseRecord();
    for (const store of ['appStore', 'play'] as const) {
      record[store].notCollected.push({
        what: 'seed packet scan',
        carriers: ['permission:CAMERA'],
        reason: 'unimportant' as never,
        note: '',
      });
    }
    expect(privacyDeclarationGaps(withPermission('CAMERA'), record)).toEqual([
      'appStore: seed packet scan gives no reason it is not collected',
      'play: seed packet scan gives no reason it is not collected',
    ]);
  });

  it('refuses a record entry for a capability app.json no longer grants', () => {
    const record = greenhouseRecord();
    record.noUserData.push({ carriers: ['permission:VIBRATE'], note: 'haptics' });
    expect(privacyDeclarationGaps(greenhouseApp, record)).toEqual([
      'appStore: permission:VIBRATE is in the record but not in app.json',
      'play: permission:VIBRATE is in the record but not in app.json',
    ]);
  });

  it('refuses an identifier declared on one store and not the other', () => {
    const record = greenhouseRecord();
    record.play.dataTypes = record.play.dataTypes.filter((d) => d.type !== 'User IDs');
    expect(privacyDeclarationGaps(greenhouseApp, record)).toEqual([
      'play: does not declare growerId, which appStore declares',
    ]);
  });

  it('refuses a kept item neither store declares', () => {
    const record = greenhouseRecord();
    record.serverHeld.push({
      id: 'greenhouseName',
      what: 'name',
      source: 'server',
      ephemeral: false,
      linkedToAthlete: true,
      deletion: [],
    });
    expect(privacyDeclarationGaps(greenhouseApp, record)).toEqual([
      'appStore: does not declare greenhouseName, which the server keeps',
      'play: does not declare greenhouseName, which the server keeps',
    ]);
  });

  it('refuses a declaration of something the server does not hold', () => {
    const record = greenhouseRecord();
    record.appStore.dataTypes[0].holds.push('soilReadings');
    expect(privacyDeclarationGaps(greenhouseApp, record)).toEqual([
      'appStore: declares soilReadings, which the server does not hold',
    ]);
  });

  it('asks nothing of an ephemeral item', () => {
    const record = greenhouseRecord();
    expect(record.serverHeld.some((i) => i.ephemeral)).toBe(true);
    expect(privacyDeclarationGaps(greenhouseApp, record)).toEqual([]);
  });

  it('refuses "not linked" for an item filed under the account', () => {
    const record = greenhouseRecord();
    record.appStore.dataTypes[1].linked = false;
    expect(privacyDeclarationGaps(greenhouseApp, record)).toEqual([
      "appStore: Device ID is declared not linked, but alertToken is filed under the athlete's account",
    ]);
  });

  it('refuses "cannot be deleted" on Play when the server can delete what it keeps', () => {
    const record = greenhouseRecord();
    record.play.deletion = { userCanRequest: false, paths: [] };
    expect(privacyDeclarationGaps(greenhouseApp, record)).toEqual([
      'play: says data cannot be deleted, but growerId, alertToken can be ' +
        '(turning alerts off; expiry after a week)',
    ]);
  });

  it('accepts "cannot be deleted" when nothing kept has a deletion path', () => {
    const record = greenhouseRecord();
    for (const item of record.serverHeld) item.deletion = [];
    record.play.deletion = { userCanRequest: false, paths: [] };
    expect(privacyDeclarationGaps(greenhouseApp, record)).toEqual([]);
  });
});

describe('the record in the tree', () => {
  it('accounts for app.json and agrees across the two stores', () => {
    expect(privacyDeclarationGaps(loadAppJson(), loadPrivacyRecord())).toEqual([]);
  });
});
