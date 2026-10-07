import type { WebdavTestOutcome } from './backends/webdavBackend';

type Translate = {
  (key: string, fallback: string): string;
  (key: string, options: { defaultValue: string; [name: string]: unknown }): string;
};

/** The sentence for a failed connection test. `urlText` is the screen's wording of an address problem. */
export function webdavTestMessage(
  outcome: Exclude<WebdavTestOutcome, { kind: 'ok' }>,
  t: Translate,
  urlText: string | null
): string {
  switch (outcome.kind) {
    case 'urlProblem':
      return urlText ?? t('backup.fillAllFields', 'Please fill in all fields');
    case 'unauthorised':
      return t('backup.webdavTestUnauthorised', 'Authentication failed');
    case 'methodNotAllowed':
      return t(
        'backup.webdavTestMethodNotAllowed',
        'Check your WebDAV URL format. The server does not accept PROPFIND at this path'
      );
    case 'status':
      return t('backup.webdavTestStatus', {
        defaultValue: 'Server returned {{code}}',
        code: outcome.code,
      });
    case 'transport':
    default:
      return t('backup.connectionFailed', 'Connection failed');
  }
}
