import { createRequire } from 'node:module';

const { keyPrefix, supersededEntries } = createRequire(__filename)(
  '../../../scripts/lib/prune-caches.js'
);

type Entry = { id: number; key: string; ref: string; created_at: string };
const MAIN = 'refs/heads/main';
const entry = (id: number, key: string, created_at: string, ref = MAIN): Entry => ({
  id,
  key,
  ref,
  created_at,
});
const ids = (entries: Entry[]) => entries.map((e) => e.id);

describe('cache pruning', () => {
  it('collapses a sha or hash generation marker into one prefix', () => {
    expect(keyPrefix('codeql-db-eb8f3a1c9d2e-linux')).toBe('codeql-db-*-linux');
    expect(keyPrefix('codeql-db-befd7720a1b3-linux')).toBe('codeql-db-*-linux');
  });

  it('keeps words and short version tokens in the prefix', () => {
    expect(keyPrefix('ccache-ios-v3-release-arm64-deadbeef12')).toBe(
      'ccache-ios-v3-release-arm64-*'
    );
    expect(keyPrefix('rust-android-abcdefabcdef')).toBe('rust-android-abcdefabcdef');
  });

  it('deletes every entry but the newest per prefix', () => {
    const entries = [
      entry(1, 'jest-aaaa1111bb', '2026-10-01T00:00:00Z'),
      entry(2, 'jest-cccc2222dd', '2026-10-03T00:00:00Z'),
      entry(3, 'jest-eeee3333ff', '2026-10-02T00:00:00Z'),
    ];
    expect(ids(supersededEntries(entries))).toEqual([1, 3]);
  });

  it('never deletes an entry of another prefix', () => {
    const entries = [
      entry(1, 'jest-aaaa1111bb', '2026-10-01T00:00:00Z'),
      entry(2, 'gradle-home-bbbb2222cc', '2026-10-01T00:00:00Z'),
      entry(3, 'rust-ios-cccc3333dd', '2026-10-01T00:00:00Z'),
    ];
    expect(supersededEntries(entries)).toEqual([]);
  });

  it('leaves entries on other refs alone and does not count them as newest', () => {
    const entries = [
      entry(1, 'jest-aaaa1111bb', '2026-10-01T00:00:00Z'),
      entry(2, 'jest-bbbb2222cc', '2026-10-09T00:00:00Z', 'refs/pull/7/merge'),
    ];
    expect(supersededEntries(entries)).toEqual([]);
  });

  it('handles an empty listing and breaks a tie on the higher id', () => {
    expect(supersededEntries([])).toEqual([]);
    const tied = [
      entry(4, 'jest-aaaa1111bb', '2026-10-01T00:00:00Z'),
      entry(5, 'jest-bbbb2222cc', '2026-10-01T00:00:00Z'),
    ];
    expect(ids(supersededEntries(tied))).toEqual([4]);
  });
});
