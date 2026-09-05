//! Guards the one failure mode that makes a skipped test indistinguishable
//! from a passing one.
//!
//! A test file carrying a crate-level `#![cfg(feature = "...")]` still builds
//! under a lane that lacks the feature. Every item compiles away, the binary
//! runs, and cargo prints `test result: ok. 0 passed`. Six files sat in that
//! state and reported green for months.
//!
//! The same gate on individual `#[test]` functions fails worse. Only those
//! functions compile away, so the file keeps its ungated tests and looks alive
//! while the gated ones report `ok. 0 passed` beside them. Both shapes are
//! offenders here.
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

/// The feature named by a `#[cfg(feature = "...")]` attribute, or `None` for a
/// `cfg` on anything else. A platform gate is not this failure mode: cargo
/// cannot express one as `required-features` and nobody expects those tests in
/// every lane.
fn feature_in_cfg_attribute(line: &str) -> Option<String> {
    if !line.starts_with("#[cfg(") {
        return None;
    }
    let (_, rest) = line.split_once("feature = \"")?;
    rest.split_once('"').map(|(feature, _)| feature.to_string())
}

fn is_test_attribute(line: &str) -> bool {
    let inner = line.strip_prefix("#[").and_then(|l| l.strip_suffix(']'));
    matches!(inner, Some(attribute) if attribute == "test" || attribute.ends_with("::test"))
}

/// The feature named by an item-level gate that removes a `#[test]`.
///
/// This is the shape one line below the crate-level gate, and it fails worse:
/// the file still has its ungated tests, so it looks alive while the gated ones
/// are reported as `ok. 0 passed`. The gate and the `#[test]` have to sit in
/// the same run of attributes, in either order, or the `cfg` is on something
/// else and removes no test from the report.
fn feature_in_item_level_test_cfg(source: &str) -> Option<String> {
    let mut feature: Option<String> = None;
    let mut has_test = false;

    for line in source.lines() {
        let line = line.trim();
        if line.starts_with("#[") {
            if let Some(found) = feature_in_cfg_attribute(line) {
                feature = Some(found);
            }
            has_test |= is_test_attribute(line);
            continue;
        }
        if line.starts_with("//") {
            continue;
        }
        if has_test {
            if let Some(feature) = feature.take() {
                return Some(feature);
            }
        }
        feature = None;
        has_test = false;
    }
    None
}

/// Why this test file's feature gate is invisible to cargo, or `None` when it
/// is not. Split out from the directory walk so a fixture can be judged
/// without writing one into `tests/`, where it would itself be scanned.
fn offender_reason(source: &str, stem: &str, gated: &BTreeSet<String>) -> Option<String> {
    if ALLOWED_WITHOUT_STANZA.contains(&stem) || gated.contains(stem) {
        return None;
    }
    if let Some(feature) = feature_in_crate_level_cfg(source) {
        return Some(format!(
            "  tests/{stem}.rs gates on feature \"{feature}\" but has no \
             [[test]] stanza, so it compiles to an empty binary and \
             reports `ok. 0 passed` without the feature"
        ));
    }
    let feature = feature_in_item_level_test_cfg(source)?;
    Some(format!(
        "  tests/{stem}.rs gates a #[test] on feature \"{feature}\" but has no \
         [[test]] stanza, so those tests compile away and report \
         `ok. 0 passed` beside the ungated ones that ran"
    ))
}

#[test]
fn every_feature_gate_has_a_cargo_stanza() {
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
        let source = fs::read_to_string(&path).expect("read test source");
        if let Some(reason) = offender_reason(&source, &stem, &gated) {
            offenders.push(reason);
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

    // An inner `cfg` on a single item is not a crate-level gate. It is the
    // item-level parser's to find, and finding it is what B261 added.
    let item_level = "use std::fs;\n\n#[cfg(feature = \"synthetic\")]\n#[test]\nfn t() {}\n";
    assert_eq!(feature_in_crate_level_cfg(item_level), None);
    assert_eq!(
        feature_in_item_level_test_cfg(item_level),
        Some("synthetic".to_string())
    );
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

/// A source file with the given lines and nothing else, for judging a shape
/// without writing it into `tests/`.
fn fixture(lines: &[&str]) -> String {
    format!("{}\n", lines.join("\n"))
}

#[test]
fn an_item_level_gate_on_a_test_without_a_stanza_is_an_offender() {
    // The shape one line below the crate-level gate: the file compiles under a
    // lane without the feature, the gated tests are removed, and cargo prints
    // `ok. 0 passed` for them beside the ungated ones that did run.
    let source = fixture(&[
        "use std::fs;",
        "",
        "#[cfg(feature = \"synthetic\")]",
        "#[test]",
        "fn gated() {}",
    ]);

    let reason = offender_reason(&source, "thing", &BTreeSet::new());

    assert!(reason.is_some(), "item-level gate went unreported");
    assert!(reason.unwrap().contains("synthetic"));
}

#[test]
fn an_item_level_gate_is_not_an_offender_once_the_stanza_names_it() {
    let source = fixture(&[
        "#[cfg(feature = \"synthetic\")]",
        "#[test]",
        "fn gated() {}",
    ]);
    let gated = BTreeSet::from(["thing".to_string()]);

    assert_eq!(offender_reason(&source, "thing", &gated), None);
}

#[test]
fn a_gate_the_test_attribute_precedes_is_the_same_offender() {
    let source = fixture(&[
        "#[test]",
        "#[cfg(feature = \"synthetic\")]",
        "fn gated() {}",
    ]);

    assert!(offender_reason(&source, "thing", &BTreeSet::new()).is_some());
}

#[test]
fn an_async_test_attribute_counts_as_a_test() {
    let source = fixture(&[
        "#[cfg(feature = \"synthetic\")]",
        "#[tokio::test]",
        "async fn gated() {}",
    ]);

    assert!(offender_reason(&source, "thing", &BTreeSet::new()).is_some());
}

#[test]
fn a_gate_on_something_that_is_not_a_test_is_not_an_offender() {
    // A cfg-gated helper beside tests that all run is not the failure mode:
    // nothing is silently removed from the report.
    let source = fixture(&[
        "#[cfg(feature = \"synthetic\")]",
        "fn helper() {}",
        "",
        "#[test]",
        "fn runs_everywhere() {}",
    ]);

    assert_eq!(offender_reason(&source, "thing", &BTreeSet::new()), None);
}

#[test]
fn a_file_with_no_gate_at_all_is_not_an_offender() {
    let source = fixture(&["#[test]", "fn t() {}"]);

    assert_eq!(offender_reason(&source, "thing", &BTreeSet::new()), None);
}

#[test]
fn a_cfg_that_is_not_a_feature_gate_is_not_an_offender() {
    // Platform gates remove tests from a lane on purpose and cargo cannot
    // express them as required-features.
    let source = fixture(&[
        "#[cfg(target_os = \"android\")]",
        "#[test]",
        "fn gated() {}",
    ]);

    assert_eq!(offender_reason(&source, "thing", &BTreeSet::new()), None);
}
