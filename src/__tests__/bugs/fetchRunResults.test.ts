/**
 * Scenario: a silent push arrives while the foreground GPS sync is
 * downloading. Both start a fetch, and both read the result out of one global
 * slot: whichever reads first takes the other's answer and acts on it, and the
 * one that started that download reads nothing and calls its own pass a
 * failure. The map's single-activity download never reads at all, so it leaves
 * a result behind for the next reader to find.
 *
 * Expected behaviour: a caller reads back only what its own start produced.
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(__dirname, '../../..');
const read = (path: string) => readFileSync(resolve(root, path), 'utf8');

const rust = read('modules/veloqrs/rust/veloqrs/src/ffi.rs');
const fetcher = read('src/features/routes/hooks/useGpsDataFetcher.ts');
const pushTask = read('src/features/insights/backgroundInsightTask.ts');

describe('the engine side', () => {
  it('answers a run id from a start and asks for one on a take', () => {
    expect(rust).toMatch(/pub fn start_fetch_and_store\([\s\S]*?\) -> u64/);
    expect(rust).toMatch(/pub fn take_fetch_and_store_result\(run: u64\)/);
  });

  it('keeps no single global result slot for every caller to share', () => {
    expect(rust).not.toMatch(/static FETCH_AND_STORE_RESULT\s*:/);
  });
});

describe('the two callers that read a result', () => {
  it('the foreground sync takes the run it started', () => {
    expect(fetcher).toMatch(/const\s+run\s*=\s*startFetchAndStore\(/);
    expect(fetcher).toMatch(/takeFetchAndStoreResult\(run\)/);
    expect(fetcher).not.toMatch(/takeFetchAndStoreResult\(\)/);
  });

  it('the push task takes the run it started', () => {
    expect(pushTask).toMatch(/const\s+run\s*=\s*startFetchAndStore\(/);
    // It reads through the wait, which is handed the take and the run.
    expect(pushTask).toMatch(/waitForRunResult\(takeFetchAndStoreResult, run\)/);
    expect(pushTask).not.toMatch(/takeFetchAndStoreResult\(\)/);
  });

  it('waits on its own run finishing rather than on a download being active', () => {
    // `active` is one global flag: the push task could see the foreground
    // sync's download finish and return holding a result that was not its own.
    expect(pushTask).not.toMatch(/if \(!progress\.active\)/);
    expect(pushTask).toMatch(/waitForRunResult|takeFetchAndStoreResult\(run\)/);
  });
});
