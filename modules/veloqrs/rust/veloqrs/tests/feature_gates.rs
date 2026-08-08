//! Guards the one failure mode that makes a skipped test indistinguishable
//! from a passing one.
//!
//! A test file carrying a crate-level `#![cfg(feature = "...")]` still builds
//! under a lane that lacks the feature. Every item compiles away, the binary
//! runs, and cargo prints `test result: ok. 0 passed`. Six files sat in that
//! state and reported green for months.
//!
//! `required-features` in Cargo.toml is the correct mechanism: cargo skips the
//! target outright and says so. This test asserts the two never drift apart.
//!
//! Deliberately ungated, so it runs in every lane.

use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

/// Test targets that are allowed to carry a crate-level `cfg` without a
/// matching stanza. Empty, and it should stay that way. A new entry here needs
/// a reason in the comment beside it.
const ALLOWED_WITHOUT_STANZA: &[&str] = &[];

fn feature_in_crate_level_cfg(source: &str) -> Option<String> {
    for line in source.lines() {
        let line = line.trim();
        if !line.starts_with("#![cfg(") {
            // Crate-level attributes must precede any item, so once real code
            // starts there is nothing left to find.
            if !line.is_empty() && !line.starts_with("//") && !line.starts_with("#![") {
                return None;
            }
            continue;
        }
        if let Some(rest) = line.split_once("feature = \"") {
            if let Some((feature, _)) = rest.1.split_once('"') {
                return Some(feature.to_string());
            }
        }
    }
    None
}

/// Names from `[[test]]` stanzas that declare `required-features`.
fn gated_test_targets(manifest: &str) -> BTreeSet<String> {
    let mut gated = BTreeSet::new();
    let mut name: Option<String> = None;
    let mut in_test_stanza = false;

    for line in manifest.lines() {
        let line = line.trim();
        if line.starts_with('[') {
            in_test_stanza = line == "[[test]]";
            name = None;
            continue;
        }
        if !in_test_stanza {
            continue;
        }
        if let Some(rest) = line.strip_prefix("name = \"") {
            name = rest.split_once('"').map(|(n, _)| n.to_string());
        } else if line.starts_with("required-features") {
            if let Some(n) = name.clone() {
                gated.insert(n);
            }
        }
    }
    gated
}

#[test]
fn every_crate_level_feature_gate_has_a_cargo_stanza() {
    let root = Path::new(env!("CARGO_MANIFEST_DIR"));
    let manifest = fs::read_to_string(root.join("Cargo.toml")).expect("read Cargo.toml");
    let gated = gated_test_targets(&manifest);

    let mut offenders = Vec::new();
    for entry in fs::read_dir(root.join("tests")).expect("read tests dir") {
        let path = entry.expect("dir entry").path();
        if path.extension().and_then(|e| e.to_str()) != Some("rs") {
            continue;
        }
        let stem = path
            .file_stem()
            .and_then(|s| s.to_str())
            .expect("utf8 file stem")
            .to_string();
        if ALLOWED_WITHOUT_STANZA.contains(&stem.as_str()) {
            continue;
        }

        let source = fs::read_to_string(&path).expect("read test source");
        if let Some(feature) = feature_in_crate_level_cfg(&source) {
            if !gated.contains(&stem) {
                offenders.push(format!(
                    "  tests/{stem}.rs gates on feature \"{feature}\" but has no \
                     [[test]] stanza, so it compiles to an empty binary and \
                     reports `ok. 0 passed` without the feature"
                ));
            }
        }
    }

    assert!(
        offenders.is_empty(),
        "test files whose feature gate is invisible to cargo:\n{}\n\nAdd to Cargo.toml:\n\
         [[test]]\nname = \"<file stem>\"\nrequired-features = [\"synthetic\"]",
        offenders.join("\n")
    );
}

#[test]
fn the_parser_recognises_a_crate_level_gate() {
    // Anchors the detector itself, so a parser regression cannot silently turn
    // the guard above into a test that passes by finding nothing.
    let gated = "#![cfg(feature = \"synthetic\")]\n\nuse std::fs;\n";
    assert_eq!(
        feature_in_crate_level_cfg(gated),
        Some("synthetic".to_string())
    );

    let ungated = "//! A doc comment.\n\nuse std::fs;\n\n#[test]\nfn t() {}\n";
    assert_eq!(feature_in_crate_level_cfg(ungated), None);

    // An inner `cfg` on a single item is not a crate-level gate and must not
    // trip the guard.
    let item_level = "use std::fs;\n\n#[cfg(feature = \"synthetic\")]\n#[test]\nfn t() {}\n";
    assert_eq!(feature_in_crate_level_cfg(item_level), None);
}

#[test]
fn the_manifest_parser_finds_known_gated_targets() {
    let manifest = fs::read_to_string(Path::new(env!("CARGO_MANIFEST_DIR")).join("Cargo.toml"))
        .expect("read Cargo.toml");
    let gated = gated_test_targets(&manifest);

    // Non-emptiness anchor: a parser that returns nothing would make the guard
    // above fail loudly rather than pass vacuously, but assert it directly so
    // the reason is obvious.
    assert!(
        gated.len() > 10,
        "expected many gated targets, found {}",
        gated.len()
    );
    assert!(gated.contains("exclusion_durability"));
    assert!(gated.contains("named_corridors"));
}
