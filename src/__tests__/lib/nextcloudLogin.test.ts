/**
 * Scenario: a Nextcloud app-password QR code carries the login name, the app
 * password and the server address, and the WebDAV endpoint is built from them.
 *
 * Expected behaviour: the login name is percent-encoded in the endpoint path
 * and kept as typed for the credentials. A code that is not a Nextcloud login,
 * or lacks a field, gives null.
 */

import { parseNextcloudLogin } from '@/features/settings/lib/autobackup/nextcloudLogin';

it('encodes a login name with a space in the endpoint path', () => {
  expect(parseNextcloudLogin('nc://login/user:a b&password:p&server:https://x.example/')).toEqual({
    url: 'https://x.example/remote.php/dav/files/a%20b/',
    user: 'a b',
    password: 'p',
  });
});

it('builds the endpoint from a server address with no trailing slash', () => {
  expect(
    parseNextcloudLogin(
      'nc://login/user:keeper@harbour.example&password:x-y-z&server:https://x.example/cloud'
    )
  ).toEqual({
    url: 'https://x.example/cloud/remote.php/dav/files/keeper%40harbour.example/',
    user: 'keeper@harbour.example',
    password: 'x-y-z',
  });
});

it('keeps a colon inside a value', () => {
  expect(
    parseNextcloudLogin('nc://login/user:keeper&password:p&server:https://x.example:8443')?.url
  ).toBe('https://x.example:8443/remote.php/dav/files/keeper/');
});

it('refuses a code that is not a Nextcloud login', () => {
  expect(parseNextcloudLogin('https://x.example/')).toBeNull();
  expect(parseNextcloudLogin('')).toBeNull();
});

it('refuses a code missing a field', () => {
  expect(parseNextcloudLogin('nc://login/user:keeper&server:https://x.example/')).toBeNull();
  expect(parseNextcloudLogin('nc://login/password:p&server:https://x.example/')).toBeNull();
  expect(parseNextcloudLogin('nc://login/user:keeper&password:p')).toBeNull();
  expect(parseNextcloudLogin('nc://login/user:&password:p&server:https://x.example/')).toBeNull();
});
