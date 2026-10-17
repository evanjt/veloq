/**
 * Scenario: an advisory published after the last lockfile change shows up in
 * the scan of every open pull request, whatever the pull request changed.
 *
 * Expected behaviour: a pull request fails only for an advisory its own
 * lockfile has and the base lockfile lacks. Warnings count the same as
 * vulnerabilities, because the full scan denies both.
 */

const { advisoryKeys, newAdvisories } = require('../../../scripts/lib/new-advisories.js');

interface Finding {
  id: string | null;
  name: string;
  version: string;
}

function vulnerability({ id, name, version }: Finding) {
  return {
    advisory: { id, package: name, title: 'Advisory', date: '2026-10-09' },
    versions: { patched: ['>=9.0.0'], unaffected: [] },
    affected: null,
    package: { name, version, source: 'registry+https://github.com/rust-lang/crates.io-index' },
  };
}

function warning(kind: string, { id, name, version }: Finding) {
  return {
    kind,
    package: { name, version, source: 'registry+https://github.com/rust-lang/crates.io-index' },
    advisory: id === null ? null : { id, package: name, title: 'Warning', date: '2026-09-01' },
    affected: null,
    versions: null,
  };
}

function scan(
  vulnerabilities: Finding[],
  warnings: Record<string, Finding[]> = {}
): Record<string, unknown> {
  return {
    database: { 'advisory-count': 1000 },
    lockfile: { 'dependency-count': 500 },
    settings: { ignore: [] },
    vulnerabilities: {
      found: vulnerabilities.length > 0,
      count: vulnerabilities.length,
      list: vulnerabilities.map(vulnerability),
    },
    warnings: Object.fromEntries(
      Object.entries(warnings).map(([kind, list]) => [kind, list.map((w) => warning(kind, w))])
    ),
  };
}

const QUIC = { id: 'RUSTSEC-2026-0338', name: 'quic-proto', version: '0.11.15' };
const TLS = { id: 'RUSTSEC-2026-0349', name: 'tls-core', version: '0.23.45' };
const STALE = { id: 'RUSTSEC-2026-0200', name: 'old-crate', version: '1.0.0' };
const YANKED = { id: null, name: 'pulled-crate', version: '2.1.0' };

describe('newAdvisories', () => {
  it('is empty when both ends carry the same advisories', () => {
    expect(newAdvisories(scan([QUIC, TLS]), scan([QUIC, TLS]))).toEqual([]);
  });

  it('is empty when neither end carries any', () => {
    expect(newAdvisories(scan([]), scan([]))).toEqual([]);
  });

  it('names an advisory only the head carries', () => {
    expect(newAdvisories(scan([QUIC]), scan([QUIC, TLS]))).toEqual(['RUSTSEC-2026-0349']);
  });

  it('is empty when the head fixes an advisory the base carries', () => {
    expect(newAdvisories(scan([QUIC, TLS]), scan([QUIC]))).toEqual([]);
  });

  it('compares an unmaintained warning the same as a vulnerability', () => {
    const base = scan([QUIC]);
    expect(newAdvisories(base, scan([QUIC], { unmaintained: [STALE] }))).toEqual([
      'RUSTSEC-2026-0200',
    ]);
    expect(
      newAdvisories(scan([], { unmaintained: [STALE] }), scan([], { unmaintained: [STALE] }))
    ).toEqual([]);
  });

  it('names a warning that moves from vulnerabilities to warnings as nothing new', () => {
    expect(newAdvisories(scan([STALE]), scan([], { unsound: [STALE] }))).toEqual([]);
  });

  it('names a yanked crate, which has no advisory id, by its name and version', () => {
    const head = scan([], { yanked: [YANKED] });
    expect(newAdvisories(scan([]), head)).toEqual(['yanked pulled-crate 2.1.0']);
    expect(newAdvisories(head, head)).toEqual([]);
    expect(newAdvisories(scan([], { yanked: [{ ...YANKED, version: '2.0.0' }] }), head)).toEqual([
      'yanked pulled-crate 2.1.0',
    ]);
  });

  it('names an advisory once when the head carries it for two versions', () => {
    const twice = scan([TLS, { ...TLS, version: '0.22.4' }]);
    expect(newAdvisories(scan([]), twice)).toEqual(['RUSTSEC-2026-0349']);
  });

  it('refuses a body that is not a cargo audit report', () => {
    expect(() => advisoryKeys({ error: 'failed to load advisory database' })).toThrow(
      /not a cargo audit report/
    );
    expect(() => advisoryKeys(null)).toThrow(/not a cargo audit report/);
  });
});
