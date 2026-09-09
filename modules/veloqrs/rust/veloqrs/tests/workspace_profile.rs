//! Release profile settings must sit at the workspace root, or cargo ignores
//! them.
//!
//! `[profile.*]` in a workspace *member* is silently discarded: cargo prints
//! `profiles for the non root package will be ignored` and builds with the
//! defaults. So a profile written here is not a description of what ships, it
//! is a wish, and nothing fails when the two disagree.
//!
//! What that cost is `B154`. Under the default `codegen-units = 16` the
//! partitioning of rstar's generic AABB distance methods across codegen units
//! decides whether they inline into the section fold's nearest-neighbour
//! queries. The warm-add median lands on ~700 ms or ~900 ms accordingly, and
//! which one is decided by unrelated edits elsewhere in the crate. Measured
//! over the private corpus, three revisions each built both ways:
//!
//! | revision  | default | codegen-units = 1 |
//! |-----------|---------|-------------------|
//! | `73c857b` |     903 |               701 |
//! | `5b2b5f9` |     697 |               697 |
//! | `a5f2d69` |     897 |               700 |
//!
//! A bisect over that column attributes a coin toss to whichever commit it
//! straddles, which is what `B154` did before this landed.

use std::path::{Path, PathBuf};

/// The workspace root, one level above this crate.
fn root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("veloqrs sits inside the workspace")
        .to_path_buf()
}

/// Section headers declared in a `Cargo.toml`, `[foo.bar]` as `foo.bar`.
fn sections(path: &Path) -> Vec<String> {
    let text =
        std::fs::read_to_string(path).unwrap_or_else(|e| panic!("read {}: {e}", path.display()));
    text.lines()
        .map(str::trim)
        .filter_map(|l| l.strip_prefix('[').and_then(|l| l.strip_suffix(']')))
        .map(|s| s.trim().to_string())
        .collect()
}

/// Member directories named by the root `[workspace] members` list.
fn members() -> Vec<PathBuf> {
    let text = std::fs::read_to_string(root().join("Cargo.toml")).expect("read the workspace root");
    let list = text
        .split_once("members")
        .and_then(|(_, rest)| rest.split_once('['))
        .and_then(|(_, rest)| rest.split_once(']'))
        .map(|(inner, _)| inner.to_string())
        .expect("the workspace declares members");
    list.split(',')
        .map(|s| s.trim().trim_matches('"').trim())
        .filter(|s| !s.is_empty())
        .map(|s| root().join(s))
        .collect()
}

#[test]
fn no_member_declares_a_profile_cargo_would_ignore() {
    let members = members();
    assert!(!members.is_empty(), "no workspace members found to check");

    for member in members {
        let manifest = member.join("Cargo.toml");
        let ignored: Vec<String> = sections(&manifest)
            .into_iter()
            .filter(|s| s == "profile" || s.starts_with("profile."))
            .collect();
        assert!(
            ignored.is_empty(),
            "{} declares {ignored:?}, which cargo discards with `profiles for the \
             non root package will be ignored`. Move it to the workspace root, or \
             the build silently uses the defaults instead.",
            manifest.display()
        );
    }
}

#[test]
fn the_root_pins_codegen_units_so_the_fold_is_not_a_coin_toss() {
    let manifest = root().join("Cargo.toml");
    let text = std::fs::read_to_string(&manifest).expect("read the workspace root");
    let release = text
        .split_once("[profile.release]")
        .map(|(_, rest)| rest.split("\n[").next().unwrap_or(rest).to_string())
        .unwrap_or_else(|| {
            panic!(
                "{} declares no [profile.release]. Without one the release build \
                 takes cargo's defaults, and `codegen-units = 16` makes the \
                 warm-add median a ~200 ms coin toss decided by unrelated edits.",
                manifest.display()
            )
        });

    let has = |k: &str, v: &str| {
        release
            .lines()
            .map(str::trim)
            .any(|l| l.starts_with(k) && l.split('=').nth(1).is_some_and(|got| got.trim() == v))
    };

    assert!(
        has("codegen-units", "1"),
        "[profile.release] must pin `codegen-units = 1`. At the default 16 the \
         section fold's rstar distance calls inline or not by partitioning luck, \
         worth ~200 ms on the warm-add median. Found:\n{release}"
    );
    assert!(
        has("lto", "true"),
        "[profile.release] must keep `lto = true`, which veloqrs has always \
         declared and never received. Found:\n{release}"
    );
}

#[test]
fn the_root_does_not_optimise_the_fold_for_size() {
    // `opt-level = "s"` was declared in veloqrs and never took effect. Honouring
    // it as written costs 2,297 ms on the same warm-add median that is 700 ms at
    // the default level 3, which is 2.5x the drip budget. Size is not worth that
    // here, so the hoist deliberately left it behind. See `B154`.
    let text = std::fs::read_to_string(root().join("Cargo.toml")).expect("read the workspace root");
    let release = text
        .split_once("[profile.release]")
        .map(|(_, rest)| rest.split("\n[").next().unwrap_or(rest).to_string())
        .unwrap_or_default();

    for level in ["\"s\"", "\"z\""] {
        assert!(
            !release
                .lines()
                .map(str::trim)
                .any(|l| l.starts_with("opt-level") && l.contains(level)),
            "[profile.release] sets opt-level = {level}, which measured 2,297 ms \
             against 700 ms at level 3 on the warm-add median. Found:\n{release}"
        );
    }
}
