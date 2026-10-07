//! Guards the shape of the test targets themselves.
//!
//! An area binary gathers many test files into one process, and the engine is
//! process-wide. A test there that opens or reads the global engine without the
//! binary's `serial_state()` races every other test that does. With a file-local
//! lock of its own it still races the binary's: one test held the engine
//! lifecycle lock waiting for the engine lock, a preview held the engine lock
//! waiting on its detection worker, and the worker waited for the lifecycle
//! lock. The run hung at 0% CPU with no timeout and stalled the merge battery.
//!
//! Every `[[test]]` stanza also says why it is its own binary, on a comment
//! line directly above it. An area binary says which area it gathers, and a
//! standalone one names the process-wide state it cannot share. A stanza with
//! neither is refused, so the binary count cannot climb back unremarked.

use std::collections::{BTreeMap, BTreeSet};
use std::fs;
use std::path::Path;

/// Calls that open, close or read the process-wide engine.
const GLOBAL_ENGINE_CALLS: &[&str] = &[
    "persistent_engine_init",
    "open_if_closed",
    "open_for_push_if_closed",
    "with_persistent_engine",
    "with_persistent_engine_at",
    "with_persistent_engine_for",
    "with_persistent_engine_blocking",
    "with_persistent_engine_blocking_for",
];

/// Type-qualified calls that open or read the process-wide engine. A bare
/// `create` or `new` is too common a name to count on its own. Every manager
/// in `objects` reads the engine through `with_engine` but the basemap one,
/// which holds its own tile store. The previews read it the same way.
const GLOBAL_ENGINE_PATHS: &[&[&str]] = &[
    &["VeloqEngine", "create"],
    &["ActivityManager", "new"],
    &["DetectionManager", "new"],
    &["FitnessManager", "new"],
    &["HeatmapManager", "new"],
    &["MapManager", "new"],
    &["RecordingManager", "new"],
    &["RouteManager", "new"],
    &["SectionManager", "new"],
    &["SectionPreview", "new"],
    &["RouteGroupingPreview", "new"],
    &["SyncService", "new"],
    &["SettingsManager", "new"],
    &["StrengthManager", "new"],
    &["SyncManager", "new"],
];

/// The guard every area binary that reaches the engine defines in its `main.rs`.
const BINARY_GUARD: &str = "serial_state";

/// Rust source with comments and string, byte-string and char literals blanked,
/// so a name inside a literal or a comment is not read as a call. Lifetimes
/// are kept: a `'` followed by an identifier and no closing quote is one.
fn code_only(source: &str) -> String {
    let chars: Vec<char> = source.chars().collect();
    let mut out = String::with_capacity(source.len());
    let mut i = 0;
    while i < chars.len() {
        let c = chars[i];
        let next = chars.get(i + 1).copied();
        if c == '/' && next == Some('/') {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
            continue;
        }
        if c == '/' && next == Some('*') {
            let mut depth = 0;
            while i < chars.len() {
                if chars[i] == '/' && chars.get(i + 1) == Some(&'*') {
                    depth += 1;
                    i += 2;
                } else if chars[i] == '*' && chars.get(i + 1) == Some(&'/') {
                    depth -= 1;
                    i += 2;
                    if depth == 0 {
                        break;
                    }
                } else {
                    i += 1;
                }
            }
            out.push(' ');
            continue;
        }
        let prefix_ends_word = i == 0 || !is_ident(chars[i - 1]);
        if (c == 'r' || (c == 'b' && next == Some('r'))) && prefix_ends_word {
            let mut j = i + if c == 'b' { 2 } else { 1 };
            let mut hashes = 0;
            while chars.get(j) == Some(&'#') {
                hashes += 1;
                j += 1;
            }
            if chars.get(j) == Some(&'"') {
                j += 1;
                loop {
                    if j >= chars.len() {
                        break;
                    }
                    if chars[j] == '"' && (1..=hashes).all(|k| chars.get(j + k) == Some(&'#')) {
                        j += 1 + hashes;
                        break;
                    }
                    j += 1;
                }
                out.push_str("\"\"");
                i = j;
                continue;
            }
        }
        if c == '"' {
            i += 1;
            while i < chars.len() && chars[i] != '"' {
                if chars[i] == '\\' {
                    i += 1;
                }
                i += 1;
            }
            i += 1;
            out.push_str("\"\"");
            continue;
        }
        if c == '\'' {
            if next == Some('\\') {
                let mut j = i + 2;
                while j < chars.len() && chars[j] != '\'' {
                    j += 1;
                }
                out.push_str("' '");
                i = j + 1;
                continue;
            }
            if chars.get(i + 2) == Some(&'\'') {
                out.push_str("' '");
                i += 3;
                continue;
            }
        }
        out.push(c);
        i += 1;
    }
    out
}

fn is_ident(c: char) -> bool {
    c.is_alphanumeric() || c == '_'
}

/// The source with each `use path::Name as Alias;` alias written back as the
/// name it stands for, so a renamed import is still seen as the type it is.
fn resolve_aliases(code: &str) -> String {
    let mut out = code.to_string();
    for statement in code.split(';') {
        let statement = statement.trim();
        let Some(rest) = statement.rfind("use ").map(|at| &statement[at + 4..]) else {
            continue;
        };
        let Some((path, alias)) = rest.rsplit_once(" as ") else {
            continue;
        };
        let name = path.rsplit("::").next().unwrap_or("").trim();
        let alias = alias.trim();
        let word = |w: &str| !w.is_empty() && w.chars().all(is_ident);
        if word(name) && word(alias) && name != alias {
            out = out.replace(&format!("{alias}::"), &format!("{name}::"));
        }
    }
    out
}

/// One function in a test file: its name, whether a test attribute sits on
/// it, and the calls its body makes, each as the path written before the `(`.
#[derive(Debug)]
struct Function {
    name: String,
    is_test: bool,
    calls: Vec<Vec<String>>,
}

/// Every `fn` in the source, with the calls made inside its body. A nested
/// function's calls count for the one around it too, which can only add a
/// reach, never hide one.
fn functions(source: &str) -> Vec<Function> {
    let code = resolve_aliases(&code_only(source));
    let chars: Vec<char> = code.chars().collect();
    let mut found = Vec::new();
    let mut i = 0;
    while i + 2 < chars.len() {
        let starts_fn = chars[i] == 'f'
            && chars[i + 1] == 'n'
            && chars[i + 2].is_whitespace()
            && (i == 0 || !is_ident(chars[i - 1]));
        if !starts_fn {
            i += 1;
            continue;
        }
        let mut j = i + 2;
        while j < chars.len() && chars[j].is_whitespace() {
            j += 1;
        }
        let name_start = j;
        while j < chars.len() && is_ident(chars[j]) {
            j += 1;
        }
        let name: String = chars[name_start..j].iter().collect();
        // The body is the first `{` after the signature, unless a `;` ends a
        // declaration first.
        let mut k = j;
        while k < chars.len() && chars[k] != '{' && chars[k] != ';' {
            k += 1;
        }
        if name.is_empty() || k >= chars.len() || chars[k] == ';' {
            i = j.max(i + 1);
            continue;
        }
        let mut depth = 0;
        let mut end = k;
        while end < chars.len() {
            match chars[end] {
                '{' => depth += 1,
                '}' => {
                    depth -= 1;
                    if depth == 0 {
                        break;
                    }
                }
                _ => {}
            }
            end += 1;
        }
        let body: String = chars[k..end.min(chars.len())].iter().collect();
        let head: String = chars[..i].iter().collect();
        found.push(Function {
            name,
            is_test: carries_test_attribute(&head),
            calls: calls_in(&body),
        });
        // Step into the body rather than over it, so nested functions are
        // found as well.
        i = k + 1;
    }
    found
}

/// Whether the attributes directly above a `fn` include a test attribute.
fn carries_test_attribute(before: &str) -> bool {
    // Drop the `fn` line's own text before the keyword, `async` or `pub`.
    let above = &before[..before.rfind('\n').map_or(0, |end| end + 1)];
    for line in above.lines().rev().map(str::trim) {
        if line.is_empty() {
            continue;
        }
        if !line.starts_with("#[") {
            return false;
        }
        let inner = line.trim_start_matches("#[").split(['(', ']']).next();
        if matches!(inner, Some(attribute) if attribute == "test" || attribute.ends_with("::test"))
        {
            return true;
        }
    }
    false
}

/// Each `path::to::name(` or `name(` in a body, as its path segments. A method
/// call, a turbofish path and a macro are not calls to a function here.
fn calls_in(body: &str) -> Vec<Vec<String>> {
    let chars: Vec<char> = body.chars().collect();
    let mut calls = Vec::new();
    for (open, _) in chars.iter().enumerate().filter(|(_, c)| **c == '(') {
        let mut end = open;
        while end > 0 && chars[end - 1].is_whitespace() {
            end -= 1;
        }
        let mut start = end;
        while start > 0 && (is_ident(chars[start - 1]) || chars[start - 1] == ':') {
            start -= 1;
        }
        // A method call names no function a module defines.
        let mut before = start;
        while before > 0 && chars[before - 1].is_whitespace() {
            before -= 1;
        }
        if before > 0 && chars[before - 1] == '.' {
            continue;
        }
        let path: String = chars[start..end].iter().collect();
        let segments: Vec<String> = path
            .split("::")
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .collect();
        if segments.last().is_some_and(|last| {
            last.chars()
                .next()
                .is_some_and(|c| c.is_alphabetic() || c == '_')
        }) {
            calls.push(segments);
        }
    }
    calls
}

/// The modules an area `main.rs` gathers, by module name and source path
/// relative to it. A `mod` with no `#[path]` is the file of its name beside it.
fn gathered_modules(main: &str) -> Vec<(String, String)> {
    let mut modules = Vec::new();
    let mut path: Option<String> = None;
    for line in main.lines().map(str::trim) {
        if let Some(rest) = line.strip_prefix("#[path = \"") {
            path = rest.split_once('"').map(|(p, _)| p.to_string());
        } else if let Some(rest) = line.strip_prefix("mod ")
            && let Some(name) = rest.strip_suffix(';')
        {
            let name = name.trim().to_string();
            let p = path.take().unwrap_or_else(|| format!("{name}.rs"));
            modules.push((name, p));
        }
    }
    modules
}

/// What a function does, closed over the calls it makes inside the binary.
#[derive(Clone, Copy, Default, PartialEq)]
struct Reach {
    engine: bool,
    guard: bool,
}

/// The tests in an area binary that reach the global engine, and those of
/// them that do so without taking the binary's `serial_state()`.
///
/// `main` is the binary's `main.rs` and `modules` each gathered module's name
/// and source. A call resolves to the function of that name in the module the
/// path names (`super::` is `main.rs`), else in the calling module, else in any
/// gathered module.
fn engine_tests(main: &str, modules: &[(String, String)]) -> EngineTests {
    let mut by_module: BTreeMap<String, Vec<Function>> = BTreeMap::new();
    by_module.insert(String::new(), functions(main));
    for (name, source) in modules {
        by_module.insert(name.clone(), functions(source));
    }
    let binary_has_guard = by_module[""].iter().any(|f| f.name == BINARY_GUARD);

    let mut reach: BTreeMap<(String, String), Reach> = BTreeMap::new();
    for (module, functions) in &by_module {
        for function in functions {
            reach.insert((module.clone(), function.name.clone()), Reach::default());
        }
    }
    let resolve = |caller: &str, call: &[String]| -> Vec<(String, String)> {
        let name = call.last().expect("a call has a name").clone();
        let qualifier = call.len().checked_sub(2).map(|i| call[i].as_str());
        let defined_in = |module: &str| {
            by_module
                .get(module)
                .is_some_and(|fs| fs.iter().any(|f| f.name == name))
        };
        match qualifier {
            Some("super" | "crate") if defined_in("") => vec![(String::new(), name)],
            Some(module) if by_module.contains_key(module) && !module.is_empty() => {
                if defined_in(module) {
                    vec![(module.to_string(), name)]
                } else {
                    Vec::new()
                }
            }
            // A type, a crate or a module outside the binary: not ours to follow.
            Some(other) if other != "self" => Vec::new(),
            _ if defined_in(caller) => vec![(caller.to_string(), name)],
            _ => by_module
                .iter()
                .filter(|(_, fs)| fs.iter().any(|f| f.name == name))
                .map(|(module, _)| (module.clone(), name.clone()))
                .collect(),
        }
    };

    loop {
        let mut changed = false;
        for (module, functions) in &by_module {
            for function in functions {
                let key = (module.clone(), function.name.clone());
                let mut now = reach[&key];
                for call in &function.calls {
                    let name = call.last().expect("a call has a name");
                    now.engine |= GLOBAL_ENGINE_CALLS.contains(&name.as_str())
                        || GLOBAL_ENGINE_PATHS
                            .iter()
                            .any(|path| call.ends_with_path(path));
                    for target in resolve(module, call) {
                        if target == key {
                            continue;
                        }
                        // Only the binary's own guard counts. A file-local
                        // lock, of whatever name, is still a second lock.
                        if target.0.is_empty() {
                            now.guard |= target.1 == BINARY_GUARD && binary_has_guard;
                            continue;
                        }
                        let callee = reach[&target];
                        now.engine |= callee.engine;
                        now.guard |= callee.guard;
                    }
                }
                if now != reach[&key] {
                    reach.insert(key, now);
                    changed = true;
                }
            }
        }
        if !changed {
            break;
        }
    }

    let mut found = EngineTests::default();
    for (module, functions) in &by_module {
        for function in functions.iter().filter(|f| f.is_test) {
            let r = reach[&(module.clone(), function.name.clone())];
            found.reaching += usize::from(r.engine);
            if r.engine && !r.guard {
                found.unguarded.push(format!("{module}::{}", function.name));
            }
        }
    }
    found
}

trait EndsWithPath {
    fn ends_with_path(&self, path: &[&str]) -> bool;
}

impl EndsWithPath for Vec<String> {
    fn ends_with_path(&self, path: &[&str]) -> bool {
        self.len() >= path.len()
            && self[self.len() - path.len()..]
                .iter()
                .zip(path)
                .all(|(segment, wanted)| segment == wanted)
    }
}

#[derive(Default)]
struct EngineTests {
    reaching: usize,
    unguarded: Vec<String>,
}

fn unguarded_engine_tests(main: &str, modules: &[(String, String)]) -> Vec<String> {
    engine_tests(main, modules).unguarded
}

/// One `[[test]]` stanza and the comment line directly above it.
#[derive(Debug)]
struct Stanza {
    name: String,
    path: String,
    reason: Option<String>,
}

fn test_stanzas(manifest: &str) -> Vec<Stanza> {
    let lines: Vec<&str> = manifest.lines().map(str::trim).collect();
    let mut stanzas = Vec::new();
    for (index, line) in lines.iter().enumerate() {
        if *line != "[[test]]" {
            continue;
        }
        let reason = index
            .checked_sub(1)
            .map(|above| lines[above])
            .and_then(|above| above.strip_prefix('#'))
            .map(|text| text.trim().to_string());
        let field = |key: &str| {
            lines[index + 1..]
                .iter()
                .take_while(|l| !l.starts_with('['))
                .find_map(|l| {
                    l.strip_prefix(key)
                        .and_then(|rest| rest.trim_start().strip_prefix("= \""))
                        .and_then(|rest| rest.split_once('"'))
                        .map(|(value, _)| value.to_string())
                })
                .unwrap_or_default()
        };
        stanzas.push(Stanza {
            name: field("name"),
            path: field("path"),
            reason,
        });
    }
    stanzas
}

/// Why a stanza's recorded reason is missing or the wrong kind, or `None`.
fn stanza_reason_offence(stanza: &Stanza) -> Option<String> {
    let area = stanza.path.ends_with("/main.rs");
    let (wanted, other) = if area {
        ("Area:", "Standalone:")
    } else {
        ("Standalone:", "Area:")
    };
    let name = &stanza.name;
    match stanza.reason.as_deref() {
        Some(reason) if reason.starts_with(other) => Some(format!(
            "  {name}: says `{other}` but its path {} makes it {}",
            stanza.path,
            if area {
                "an area binary"
            } else {
                "a standalone binary"
            }
        )),
        Some(reason) if reason.starts_with(wanted) => {
            let text = reason[wanted.len()..].trim();
            (text.len() < 12)
                .then(|| format!("  {name}: `# {wanted}` names no reason, `{text}` is not one"))
        }
        _ => Some(format!(
            "  {name}: no `# {wanted} ...` line directly above its [[test]] stanza"
        )),
    }
}

fn crate_root() -> &'static Path {
    Path::new(env!("CARGO_MANIFEST_DIR"))
}

#[test]
fn every_test_in_an_area_binary_that_reaches_the_engine_takes_its_serial_guard() {
    let root = crate_root();
    let manifest = fs::read_to_string(root.join("Cargo.toml")).expect("read Cargo.toml");
    let mut offenders = Vec::new();
    let mut reaching = 0;
    for stanza in test_stanzas(&manifest) {
        if !stanza.path.ends_with("/main.rs") {
            continue;
        }
        let main_path = root.join(&stanza.path);
        let main = fs::read_to_string(&main_path).expect("read an area main.rs");
        let dir = main_path.parent().expect("main.rs has a directory");
        let modules: Vec<(String, String)> = gathered_modules(&main)
            .into_iter()
            .map(|(name, path)| {
                let source = fs::read_to_string(dir.join(&path))
                    .unwrap_or_else(|e| panic!("read {path} for {}: {e}", stanza.name));
                (name, source)
            })
            .collect();
        let found = engine_tests(&main, &modules);
        reaching += found.reaching;
        for offender in found.unguarded {
            offenders.push(format!("  {}: {offender}", stanza.name));
        }
    }
    // A reader that finds no engine test would pass by finding nothing.
    assert!(
        reaching > 100,
        "found only {reaching} tests reaching the engine in area binaries"
    );
    assert!(
        offenders.is_empty(),
        "these tests reach the process-wide engine without their binary's \
         `super::serial_state()`, so they race every other engine test in the \
         binary and can deadlock it:\n{}",
        offenders.join("\n")
    );
}

#[test]
fn every_test_target_records_why_it_is_its_own_binary() {
    let manifest = fs::read_to_string(crate_root().join("Cargo.toml")).expect("read Cargo.toml");
    let stanzas = test_stanzas(&manifest);
    assert!(stanzas.len() > 10, "found only {} stanzas", stanzas.len());
    let offences: Vec<String> = stanzas.iter().filter_map(stanza_reason_offence).collect();
    assert!(
        offences.is_empty(),
        "every [[test]] stanza carries `# Area: <what it gathers>` or \
         `# Standalone: <the process-wide state it cannot share>` on the line \
         above it. A test with no such state belongs in an area binary:\n{}",
        offences.join("\n")
    );
}

/// The `main.rs` of a fixture binary that defines the guard.
const GUARDED_MAIN: &str = "use std::sync::{Mutex, MutexGuard};\n\
    static SERIAL: Mutex<()> = Mutex::new(());\n\
    fn serial_state() -> MutexGuard<'static, ()> {\n\
        SERIAL.lock().unwrap_or_else(|e| e.into_inner())\n\
    }\n";

fn module(name: &str, source: &str) -> (String, String) {
    (name.to_string(), source.to_string())
}

#[test]
fn a_test_that_inits_the_engine_through_a_helper_without_the_guard_is_an_offender() {
    let source = "fn seed() { assert!(persistent_engine_init(path)); }\n\
        #[test]\nfn reads() {\n    seed();\n}\n";

    assert_eq!(
        unguarded_engine_tests(GUARDED_MAIN, &[module("corridor", source)]),
        vec!["corridor::reads".to_string()]
    );
}

#[test]
fn a_file_local_lock_does_not_stand_in_for_the_binary_guard() {
    let source = "static SERIAL: Mutex<()> = Mutex::new(());\n\
        fn serial() -> MutexGuard<'static, ()> { SERIAL.lock().unwrap() }\n\
        fn serial_state() -> MutexGuard<'static, ()> { serial() }\n\
        #[test]\nfn reads() {\n    let _g = serial();\n    let _s = serial_state();\n    \
        with_persistent_engine(|e| e.load());\n}\n";

    assert_eq!(
        unguarded_engine_tests(GUARDED_MAIN, &[module("corridor", source)]),
        vec!["corridor::reads".to_string()]
    );
}

#[test]
fn a_test_taking_the_guard_directly_or_through_a_helper_is_not_an_offender() {
    let source = "fn lock() -> MutexGuard<'static, ()> { super::serial_state() }\n\
        fn seed() { persistent_engine_init(path); }\n\
        #[test]\nfn direct() {\n    let _s = super::serial_state();\n    seed();\n}\n\
        #[tokio::test]\nasync fn through_a_helper() {\n    let _s = lock();\n    seed();\n}\n";

    assert!(unguarded_engine_tests(GUARDED_MAIN, &[module("corridor", source)]).is_empty());
}

#[test]
fn a_helper_in_a_support_module_carries_its_reach_to_the_caller() {
    let support = "pub fn open(path: &str) { persistent_engine_init(path.into()); }\n\
        pub fn guarded() -> MutexGuard<'static, ()> { super::serial_state() }\n";
    let unguarded = "#[test]\nfn opens() { support::open(\"x\"); }\n";
    let guarded = "#[test]\nfn opens() { let _g = support::guarded(); support::open(\"x\"); }\n";

    assert_eq!(
        unguarded_engine_tests(
            GUARDED_MAIN,
            &[module("support", support), module("unguarded", unguarded)]
        ),
        vec!["unguarded::opens".to_string()]
    );
    assert!(
        unguarded_engine_tests(
            GUARDED_MAIN,
            &[module("support", support), module("guarded", guarded)]
        )
        .is_empty()
    );
}

#[test]
fn a_binary_with_no_guard_cannot_satisfy_one() {
    let source = "#[test]\nfn reads() {\n    let _s = super::serial_state();\n    \
        with_persistent_engine(|e| e.load());\n}\n";

    assert_eq!(
        unguarded_engine_tests("", &[module("corridor", source)]),
        vec!["corridor::reads".to_string()]
    );
}

#[test]
fn an_engine_name_in_a_string_or_comment_is_not_a_call() {
    let source = "#[test]\nfn reads_the_source() {\n    \
        // persistent_engine_init(path) is what the hook calls\n    \
        let needle = \"with_persistent_engine_blocking(\";\n    \
        let raw = r#\"persistent_engine_init(\"x\")\"#;\n    \
        assert!(SOURCE.contains(needle) && !raw.is_empty());\n}\n";

    assert!(unguarded_engine_tests(GUARDED_MAIN, &[module("text", source)]).is_empty());
}

#[test]
fn a_method_or_a_type_path_does_not_resolve_to_a_helper_of_the_same_name() {
    let support = "pub fn new() { persistent_engine_init(path); }\n\
        pub fn write() { with_persistent_engine(|e| e.load()); }\n";
    let source = "#[test]\nfn local() {\n    let engine = PersistentEngine::new(path);\n    \
        let _g = engine.write();\n}\n";

    assert!(
        unguarded_engine_tests(
            GUARDED_MAIN,
            &[module("support", support), module("local", source)]
        )
        .is_empty()
    );
}

#[test]
fn creating_the_app_engine_or_a_manager_reaches_the_global_engine() {
    let source = "#[test]\nfn launches() {\n    let _engine = veloqrs::VeloqEngine::create(path);\n}\n\
        #[test]\nfn builds() {\n    let _engine = Builder::create(path);\n}\n\
        #[test]\nfn lists() {\n    let _ = SectionManager::new().get_sections(filter);\n}\n";

    assert_eq!(
        unguarded_engine_tests(GUARDED_MAIN, &[module("launch", source)]),
        vec!["launch::launches".to_string(), "launch::lists".to_string()]
    );
}

#[test]
fn building_a_preview_or_the_sync_service_reaches_the_global_engine() {
    let source = "#[test]\nfn section() {\n    let _ = SectionPreview::new().current(key);\n}\n\
        #[test]\nfn grouping() {\n    let _ = RouteGroupingPreview::new();\n}\n\
        #[test]\nfn sync() {\n    let _ = SyncService::new();\n}\n";

    assert_eq!(
        unguarded_engine_tests(GUARDED_MAIN, &[module("previews", source)]),
        vec![
            "previews::section".to_string(),
            "previews::grouping".to_string(),
            "previews::sync".to_string()
        ]
    );
}

#[test]
fn a_manager_imported_under_another_name_still_reaches_the_global_engine() {
    let source = "use veloqrs::objects::SectionManager as M;\n\
        #[test]\nfn lists() {\n    let _ = M::new().get_sections(filter);\n}\n";

    assert_eq!(
        unguarded_engine_tests(GUARDED_MAIN, &[module("aliased", source)]),
        vec!["aliased::lists".to_string()]
    );
}

#[test]
fn a_test_that_never_reaches_the_engine_needs_no_guard() {
    let source = "#[test]\nfn pure() {\n    let engine = PersistentEngine::new(path);\n    \
        assert!(engine.is_ok());\n}\n";

    assert!(unguarded_engine_tests(GUARDED_MAIN, &[module("pure", source)]).is_empty());
}

#[test]
fn the_area_reader_names_each_gathered_module_and_its_path() {
    let main = "#[path = \"../support/mod.rs\"]\nmod support;\n\n\
        #[path = \"../corridor.rs\"]\nmod corridor;\n\nmod beside;\n\nmod inline {}\n";

    assert_eq!(
        gathered_modules(main),
        vec![
            ("support".to_string(), "../support/mod.rs".to_string()),
            ("corridor".to_string(), "../corridor.rs".to_string()),
            ("beside".to_string(), "beside.rs".to_string()),
        ]
    );
}

fn stanza_fixture(above: &str, name: &str, path: &str) -> Stanza {
    let manifest = format!("{above}\n[[test]]\nname = \"{name}\"\npath = \"{path}\"\n");
    test_stanzas(&manifest)
        .into_iter()
        .next()
        .expect("one stanza")
}

#[test]
fn a_new_stanza_with_no_reason_is_refused() {
    let bare = stanza_fixture("", "new_flat_test", "tests/new_flat_test.rs");
    let blank_line_between = test_stanzas(
        "# Standalone: installs a global allocator\n\n[[test]]\nname = \"x\"\npath = \"tests/x.rs\"\n",
    );

    assert!(stanza_reason_offence(&bare).is_some());
    assert!(stanza_reason_offence(&blank_line_between[0]).is_some());
}

#[test]
fn a_reason_of_the_wrong_kind_or_with_no_words_is_refused() {
    let area_claimed_standalone =
        stanza_fixture("# Area: gathers nothing in particular", "x", "tests/x.rs");
    let standalone_claimed_area = stanza_fixture(
        "# Standalone: installs a global allocator",
        "x",
        "tests/x/main.rs",
    );
    let empty = stanza_fixture("# Standalone: needs", "x", "tests/x.rs");

    assert!(stanza_reason_offence(&area_claimed_standalone).is_some());
    assert!(stanza_reason_offence(&standalone_claimed_area).is_some());
    assert!(stanza_reason_offence(&empty).is_some());
}

#[test]
fn a_stanza_with_its_reason_is_accepted() {
    let standalone = stanza_fixture(
        "# Standalone: installs a counting global allocator",
        "track_read",
        "tests/track_read.rs",
    );
    let area = stanza_fixture(
        "# Area: the preview tests, which share the global engine",
        "preview",
        "tests/preview/main.rs",
    );

    assert_eq!(stanza_reason_offence(&standalone), None);
    assert_eq!(stanza_reason_offence(&area), None);
}

#[test]
fn the_stanza_reader_takes_name_and_path_beside_required_features() {
    let stanzas = test_stanzas(
        "# Area: a\n[[test]]\nname = \"a\"\npath = \"tests/a/main.rs\"\nrequired-features = [\"synthetic\"]\n\n\
         [[bench]]\nname = \"b\"\npath = \"benches/b.rs\"\n",
    );

    assert_eq!(stanzas.len(), 1);
    assert_eq!(stanzas[0].name, "a");
    assert_eq!(stanzas[0].path, "tests/a/main.rs");
    assert_eq!(stanzas[0].reason.as_deref(), Some("Area: a"));
    let names: BTreeSet<&str> = stanzas.iter().map(|s| s.name.as_str()).collect();
    assert!(names.contains("a"));
}

/// Public functions in `source` that open, close or read the process-wide
/// engine by the crate's naming: the `with_persistent_engine` family, the
/// `*_if_closed` openers and `persistent_engine_init`.
fn engine_entry_points(source: &str) -> Vec<String> {
    let code = code_only(source);
    let mut found = Vec::new();
    for (at, _) in code.match_indices("pub fn ") {
        let name: String = code[at + "pub fn ".len()..]
            .chars()
            .take_while(|c| c.is_alphanumeric() || *c == '_')
            .collect();
        if name.starts_with("with_persistent_engine")
            || name.ends_with("_if_closed")
            || name == "persistent_engine_init"
        {
            found.push(name);
        }
    }
    found
}

fn rust_files(dir: &Path, out: &mut Vec<std::path::PathBuf>) {
    for entry in fs::read_dir(dir).expect("source directory") {
        let path = entry.expect("directory entry").path();
        if path.is_dir() {
            rust_files(&path, out);
        } else if path.extension().is_some_and(|e| e == "rs") {
            out.push(path);
        }
    }
}

#[test]
fn the_entry_point_reader_finds_the_engine_openers_and_readers_by_name() {
    let source = "pub fn with_persistent_engine_for(x: u64) {}\n\
        pub fn open_if_closed() {}\n\
        pub fn persistent_engine_init() {}\n\
        pub fn unrelated() {}\n\
        // pub fn with_persistent_engine_in_a_comment() {}\n";

    assert_eq!(
        engine_entry_points(source),
        vec![
            "with_persistent_engine_for",
            "open_if_closed",
            "persistent_engine_init"
        ]
    );
}

#[test]
fn every_engine_entry_point_in_src_is_in_the_guards_call_list() {
    let mut files = Vec::new();
    rust_files(&crate_root().join("src"), &mut files);

    let mut missing = BTreeSet::new();
    for file in files {
        let source = fs::read_to_string(&file).expect("source file");
        for name in engine_entry_points(&source) {
            if !GLOBAL_ENGINE_CALLS.contains(&name.as_str()) {
                missing.insert(format!("{name} ({})", file.display()));
            }
        }
    }

    assert!(
        missing.is_empty(),
        "These engine entry points are not in GLOBAL_ENGINE_CALLS, so a test in an \
         area binary reaching the engine through them goes unguarded:\n{}",
        missing.into_iter().collect::<Vec<_>>().join("\n")
    );
}
