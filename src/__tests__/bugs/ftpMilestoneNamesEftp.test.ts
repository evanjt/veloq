/**
 * Scenario: the FTP milestone reads `sportInfo[].eftp` from the stored wellness
 * body, intervals.icu's estimate from the power curve, and compared it against
 * the value 30 days earlier. Its copy called all of that "your FTP setting".
 *
 * Expected behaviour: an athlete whose setting has been 250 W all year, and
 * whose eFTP moved, is told which number moved and what it was compared with.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { runGit } from '../__shared__/gitFixture';

const ROOT = join(__dirname, '../../..');

function locales(): string[] {
  return runGit(['ls-files', 'src/i18n/locales/*.json'], ROOT).split('\n').filter(Boolean);
}

type Bundle = {
  insights: {
    ftpIncrease: string;
    data: { currentFtp: string; previousFtp: string };
    methodology: { ftpEstimationName: string; ftpEstimation: string };
  };
};

function bundle(path: string): Bundle {
  return JSON.parse(readFileSync(join(ROOT, path), 'utf8')) as Bundle;
}

it('names eFTP on the card in every locale', () => {
  const missing = locales().filter((path) => {
    const { ftpIncrease, data } = bundle(path).insights;
    return ![ftpIncrease, data.currentFtp, data.previousFtp].every((line) => line.includes('eFTP'));
  });

  expect(missing).toEqual([]);
});

it('names eFTP in the methodology of every locale, and no longer the setting alone', () => {
  const missing = locales().filter((path) => {
    const { ftpEstimationName, ftpEstimation } = bundle(path).insights.methodology;
    return !ftpEstimationName.includes('eFTP') || !ftpEstimation.includes('eFTP');
  });

  expect(missing).toEqual([]);
});

it('says the comparison is against 30 days earlier, which is FTP_LOOKBACK_DAYS', () => {
  const rust = readFileSync(
    join(ROOT, 'modules/veloqrs/rust/veloqrs/src/persistence/fitness/derivations.rs'),
    'utf8'
  );
  expect(rust).toContain('const FTP_LOOKBACK_DAYS: i64 = 30;');

  const missing = locales().filter(
    (path) => !/\b30\b/.test(bundle(path).insights.methodology.ftpEstimation)
  );

  expect(missing).toEqual([]);
});
