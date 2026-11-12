//! Scenario: a record holding the matcher's box goes to the browser as JSON.
//!
//! Expected behaviour: the box is a camelCase record, an absent one is
//! `null`, and both read back to the same box.

use serde::{Deserialize, Serialize};
use tracematch::Bounds;

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct Carrier {
    #[serde(with = "crate::remote::bounds::option")]
    held: Option<Bounds>,
}

fn bounds() -> Bounds {
    Bounds {
        min_lat: 46.2,
        max_lat: 46.3,
        min_lng: 7.1,
        max_lng: 7.2,
    }
}

#[test]
fn a_box_is_a_camel_case_record() {
    let carrier = Carrier {
        held: Some(bounds()),
    };
    let json = serde_json::to_value(&carrier).unwrap();
    assert_eq!(json["held"]["minLat"], 46.2);
    assert_eq!(json["held"]["maxLng"], 7.2);
    assert!(json["held"].get("min_lat").is_none());
}

#[test]
fn an_absent_box_is_null_and_every_box_reads_back() {
    let carrier = Carrier { held: None };
    let json = serde_json::to_value(&carrier).unwrap();
    assert!(json["held"].is_null());
    let back: Carrier = serde_json::from_value(json).unwrap();
    assert_eq!(back, carrier);
    let held = Carrier {
        held: Some(bounds()),
    };
    let back: Carrier = serde_json::from_value(serde_json::to_value(&held).unwrap()).unwrap();
    assert_eq!(back, held);
}
