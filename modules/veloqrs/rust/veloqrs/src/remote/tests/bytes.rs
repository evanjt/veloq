//! Scenario: a record with byte fields goes to the browser as JSON.
//!
//! Expected behaviour: each byte field is one base64 string, an absent
//! optional one is `null`, and both read back to the same bytes.

use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, PartialEq, Debug)]
struct Carrier {
    #[serde(with = "crate::remote::bytes")]
    track: Vec<u8>,
    #[serde(with = "crate::remote::bytes::option")]
    spare: Option<Vec<u8>>,
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn bytes_are_one_base64_string_not_an_array_of_numbers() {
    let carrier = Carrier {
        track: vec![0, 1, 2, 250, 251, 252, 253],
        spare: Some(vec![255]),
    };
    let json = serde_json::to_value(&carrier).unwrap();
    assert_eq!(json["track"], "AAEC+vv8/Q==");
    assert_eq!(json["spare"], "/w==");
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn an_absent_optional_field_is_null_and_an_empty_one_is_an_empty_string() {
    let carrier = Carrier {
        track: Vec::new(),
        spare: None,
    };
    let json = serde_json::to_value(&carrier).unwrap();
    assert_eq!(json["track"], "");
    assert!(json["spare"].is_null());
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn bytes_read_back_and_a_bad_string_is_refused() {
    let carrier = Carrier {
        track: (0..=255).collect(),
        spare: None,
    };
    let text = serde_json::to_string(&carrier).unwrap();
    assert_eq!(serde_json::from_str::<Carrier>(&text).unwrap(), carrier);
    assert!(serde_json::from_str::<Carrier>(r#"{"track":"!!","spare":null}"#).is_err());
}
