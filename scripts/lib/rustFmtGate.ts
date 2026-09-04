/**
 * Which staged files the Rust formatting gate has to check.
 *
 * `cargo fmt` runs in CI and nowhere else, so unformatted Rust lands, the Rust
 * Lint job goes red, and nobody watching a local session sees it. The same red
 * gate was found three times on one afternoon.
 *
 * The check is per file with `rustfmt` rather than `cargo fmt -p veloqrs`, for
 * two reasons. `cargo fmt` needs `cargo metadata` to load the workspace, which
 * fails outright when the tracematch submodule is absent, and it checks the
 * whole crate rather than what is being committed. `rustfmt` needs neither the
 * workspace nor the submodule, and the crate has no `rustfmt.toml`, so the
 * edition is the only setting either of them applies.
 */

/** The crate this repository owns. tracematch is a submodule with its own CI. */
const OWNED_CRATE = 'modules/veloqrs/rust/veloqrs/';

/** The edition rustfmt has to be told about, since it is not reading Cargo.toml. */
export const EDITION = '2024';

/** The Rust files in `staged` that this repository is responsible for. */
export function stagedRustFiles(staged: string[]): string[] {
  return staged
    .map((file) => file.replace(/\\/g, '/').trim())
    .filter((file) => file.endsWith('.rs') && file.startsWith(OWNED_CRATE));
}

/** Split a `-z` separated list from git into paths. */
export function parseStagedList(raw: string): string[] {
  return raw.split('\0').filter((entry) => entry.length > 0);
}
