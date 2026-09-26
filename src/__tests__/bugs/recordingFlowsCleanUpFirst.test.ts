/**
 * Scenario: a recording flow dies half way and leaves a session paused. The
 * record FAB hides while a session is active, so every later flow in the pack
 * fails on `record-fab`, and the return pill covers the feed.
 * Expected behaviour: every pack-recording flow discards a leftover session
 * before it does anything else, so cleanup does not depend on the previous
 * flow having finished.
 */

import * as fs from 'fs';
import * as path from 'path';

const MAESTRO_DIR = path.resolve(__dirname, '../../../.maestro');
const HELPER = 'helpers/discard-recording.yaml';

const recordingFlows = fs
  .readdirSync(MAESTRO_DIR)
  .filter((f) => f.endsWith('.yaml'))
  .filter((f) => fs.readFileSync(path.join(MAESTRO_DIR, f), 'utf8').includes('pack-recording'))
  .sort();

describe('recording flows clean up before they start', () => {
  it('has recording flows to guard', () => {
    expect(recordingFlows.length).toBeGreaterThan(0);
  });

  it('ships the discard helper', () => {
    const helper = fs.readFileSync(path.join(MAESTRO_DIR, HELPER), 'utf8');

    // The pill is the only handle on a session another flow started: the live
    // route needs the activity type, which the helper does not know.
    expect(helper).toContain('recording-return-pill');
    expect(helper).toContain('control-stop');
    expect(helper).toContain('review-discard-button');
  });

  it.each(recordingFlows)('%s runs the discard helper after the demo setup', (file) => {
    const body = fs.readFileSync(path.join(MAESTRO_DIR, file), 'utf8');
    const discard = body.indexOf(HELPER);
    const setup = body.indexOf('helpers/setup-demo-mode.yaml');

    expect(setup).toBeGreaterThan(-1);
    expect(discard).toBeGreaterThan(setup);
  });
});
