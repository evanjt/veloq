//! Where an activity came from, and which id upstream knows it by.
//!
//! `activities.id` holds keys from four namespaces, and the key alone says
//! which: intervals.icu's own ids, keys the device minted for a recording,
//! keys the seeded demo corpora use, and keys reserved for activities read
//! from a file. Every rule that turns a key into an upstream id, or decides
//! whether a row may be asked for or compared against the census, starts
//! here. The SQL predicates that cannot call these functions name the one
//! they encode, and spell the prefixes as `'local-%'` and `'src-%'` or bind
//! the constants below.

/// The prefix every device-minted activity key carries. intervals.icu ids are
/// `i` and digits and the seeded corpora use `demo-`, so this namespace is
/// ours alone and the four can share `activities.id` without meeting.
pub const LOCAL_KEY_PREFIX: &str = "local-";

/// The prefix the seeded demo corpora give their activity keys.
pub const DEMO_KEY_PREFIX: &str = "demo-";

/// The prefix reserved for activities read from a file rather than handed
/// down by intervals.icu. Nothing mints one yet; the rules below already keep
/// such a key out of every census and every upstream ask, so the day an
/// import writes one it is not removed on the next sync.
pub const SOURCE_KEY_PREFIX: &str = "src-";

/// Which namespace an activity key belongs to.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ActivityOrigin {
    /// A key intervals.icu minted, which is its own upstream id.
    Intervals,
    /// A key the device minted for a recording. Upstream knows it only by
    /// the id an upload recorded.
    Device,
    /// A key a seeded demo corpus uses. It is stored as its own upstream id,
    /// though no upstream holds it.
    Demo,
    /// A key reserved for an activity read from a file. Like a device key,
    /// upstream knows it only by the id an upload recorded.
    Source,
}

impl ActivityOrigin {
    /// Whether upstream can know the activity only through an upload's id,
    /// since this library minted the key.
    pub fn minted_here(self) -> bool {
        matches!(self, Self::Device | Self::Source)
    }
}

/// The namespace of `key`. Demo is checked first, so a demo key is never
/// read as any other origin.
pub fn origin_of(key: &str) -> ActivityOrigin {
    if key.starts_with(DEMO_KEY_PREFIX) {
        ActivityOrigin::Demo
    } else if key.starts_with(LOCAL_KEY_PREFIX) {
        ActivityOrigin::Device
    } else if key.starts_with(SOURCE_KEY_PREFIX) {
        ActivityOrigin::Source
    } else {
        ActivityOrigin::Intervals
    }
}

/// Whether intervals.icu can know an activity by this key. A device-minted
/// key, a seeded demo key and an imported key name nothing upstream, so
/// asking for any of them spends a request to learn nothing.
pub fn names_upstream_activity(activity_id: &str) -> bool {
    origin_of(activity_id) == ActivityOrigin::Intervals
}

/// The `intervals_id` the ingest writes beside a newly stored key. A key
/// minted here has none until an upload answers; every other key, demo
/// included, is recorded as its own id.
pub fn ingest_intervals_id(key: &str) -> Option<&str> {
    (!origin_of(key).minted_here()).then_some(key)
}

/// The id a URL upstream may name for `key`, given the id stored for it. A
/// stored id wins whatever the origin. With none stored, a key minted here
/// names nothing upstream and every other key is its own id.
pub fn intervals_upstream(key: &str, stored: Option<String>) -> Option<String> {
    match stored {
        Some(id) => Some(id),
        None if origin_of(key).minted_here() => None,
        None => Some(key.to_string()),
    }
}

/// The id a fetch names `key` by: the stored id, else the key.
///
/// Reached only through queues whose SQL already leaves out a key minted
/// here that no upload has named, and from push, whose key is the server's
/// own id from a webhook. So the key fallback serves the rows an older build
/// stored and a lookup made while the engine was closed.
pub fn upstream_or_key<'a>(key: &'a str, stored: Option<&'a str>) -> &'a str {
    stored.unwrap_or(key)
}

#[cfg(test)]
mod tests {
    use super::*;

    struct Case {
        key: &'static str,
        stored: Option<&'static str>,
        origin: ActivityOrigin,
        ingest: Option<&'static str>,
        upstream: Option<&'static str>,
        or_key: &'static str,
    }

    const CASES: [Case; 7] = [
        Case {
            key: "i123",
            stored: None,
            origin: ActivityOrigin::Intervals,
            ingest: Some("i123"),
            upstream: Some("i123"),
            or_key: "i123",
        },
        Case {
            key: "local-ab",
            stored: None,
            origin: ActivityOrigin::Device,
            ingest: None,
            upstream: None,
            or_key: "local-ab",
        },
        Case {
            key: "local-ab",
            stored: Some("i9"),
            origin: ActivityOrigin::Device,
            ingest: None,
            upstream: Some("i9"),
            or_key: "i9",
        },
        Case {
            key: "demo-x",
            stored: Some("demo-x"),
            origin: ActivityOrigin::Demo,
            ingest: Some("demo-x"),
            upstream: Some("demo-x"),
            or_key: "demo-x",
        },
        Case {
            key: "demo-x",
            stored: None,
            origin: ActivityOrigin::Demo,
            ingest: Some("demo-x"),
            upstream: Some("demo-x"),
            or_key: "demo-x",
        },
        Case {
            key: "src-file-a",
            stored: None,
            origin: ActivityOrigin::Source,
            ingest: None,
            upstream: None,
            or_key: "src-file-a",
        },
        Case {
            key: "src-file-a",
            stored: Some("i7"),
            origin: ActivityOrigin::Source,
            ingest: None,
            upstream: Some("i7"),
            or_key: "i7",
        },
    ];

    #[test]
    fn a_seeded_key_keeps_the_upstream_id_it_was_stored_with() {
        for case in &CASES {
            let at = format!("{} stored {:?}", case.key, case.stored);
            assert_eq!(origin_of(case.key), case.origin, "{at}");
            assert_eq!(ingest_intervals_id(case.key), case.ingest, "{at}");
            assert_eq!(
                intervals_upstream(case.key, case.stored.map(str::to_string)).as_deref(),
                case.upstream,
                "{at}"
            );
            assert_eq!(upstream_or_key(case.key, case.stored), case.or_key, "{at}");
        }
    }

    #[test]
    fn only_a_server_key_names_an_activity_upstream() {
        assert!(names_upstream_activity("i123"));
        for key in ["local-ab", "demo-x", "src-file-a"] {
            assert!(!names_upstream_activity(key), "{key}");
        }
    }
}
