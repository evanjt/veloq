// The advisories a pull request brings in, judged against its base lockfile.
//
// An advisory published after the last lockfile change appears in the scan of
// every open pull request, whatever it changed. Comparing the two ends fails a
// pull request only for what its own lockfile adds, and the full scan on main
// still reports the rest.

/**
 * Every advisory a `cargo audit --json` report carries, vulnerabilities and
 * warnings alike, since the full scan denies both. A yanked crate has no
 * advisory, so it is keyed by its name and version.
 */
function advisoryKeys(report) {
  if (!report || typeof report !== 'object' || !report.vulnerabilities) {
    throw new Error('not a cargo audit report');
  }
  const findings = [
    ...(report.vulnerabilities.list ?? []),
    ...Object.values(report.warnings ?? {}).flat(),
  ];
  return new Set(
    findings.map((finding) =>
      finding.advisory?.id
        ? finding.advisory.id
        : `${finding.kind ?? 'unknown'} ${finding.package?.name} ${finding.package?.version}`
    )
  );
}

/** The advisories the head report carries and the base report lacks, sorted. */
function newAdvisories(baseReport, headReport) {
  const base = advisoryKeys(baseReport);
  return [...advisoryKeys(headReport)].filter((key) => !base.has(key)).sort();
}

module.exports = { advisoryKeys, newAdvisories };
