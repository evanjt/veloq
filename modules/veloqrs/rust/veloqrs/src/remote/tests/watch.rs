//! A watch's hello is answered from the link's own version window.

use super::*;
use crate::remote::protocol::{MIN_PROTOCOL_VERSION, PROTOCOL_VERSION};
use serde_json::Value;

fn parsed(reply: &str) -> Value {
    serde_json::from_str(reply).unwrap()
}

#[test]
fn watch_inside_window_gets_highest_shared_version() {
    let reply = parsed(&hello_reply(2, 9));
    assert_eq!(reply["id"], 0);
    assert_eq!(reply["result"]["protocol"], PROTOCOL_VERSION);
    assert_eq!(reply["result"]["minProtocol"], MIN_PROTOCOL_VERSION);
    assert_eq!(reply["result"]["maxProtocol"], PROTOCOL_VERSION);
}

#[test]
fn watch_speaking_only_an_older_version_gets_that_version() {
    let reply = parsed(&hello_reply(MIN_PROTOCOL_VERSION, MIN_PROTOCOL_VERSION));
    assert_eq!(reply["result"]["protocol"], MIN_PROTOCOL_VERSION);
}

#[test]
fn watch_below_window_is_refused_with_both_ranges() {
    let reply = parsed(&hello_reply(0, MIN_PROTOCOL_VERSION - 1));
    assert_eq!(reply["error"], "version");
    assert_eq!(reply["minProtocol"], MIN_PROTOCOL_VERSION);
    assert_eq!(reply["maxProtocol"], PROTOCOL_VERSION);
    assert!(reply.get("result").is_none());
}

#[test]
fn watch_above_window_is_refused() {
    let reply = parsed(&hello_reply(PROTOCOL_VERSION + 1, PROTOCOL_VERSION + 2));
    assert_eq!(reply["error"], "version");
}

#[test]
fn inverted_range_is_refused() {
    assert_eq!(parsed(&hello_reply(5, 2))["error"], "version");
}

#[test]
fn wider_hello_after_a_refusal_is_answered() {
    assert_eq!(parsed(&hello_reply(0, 1))["error"], "version");
    let reply = parsed(&hello_reply(0, PROTOCOL_VERSION));
    assert_eq!(reply["result"]["protocol"], PROTOCOL_VERSION);
}

#[test]
fn request_naming_a_version_outside_the_window_is_refused_before_dispatch() {
    let reply = parsed(&answer(
        r#"{"id":4,"method":"feed.page","params":{},"protocol":99}"#,
    ));
    assert_eq!(reply["id"], 4);
    assert_eq!(reply["error"], "version");
}

#[test]
fn hello_request_through_answer_matches_hello_reply() {
    let request = format!(
        r#"{{"id":0,"method":"link.hello","params":{{"protocol":{PROTOCOL_VERSION},"minProtocol":{MIN_PROTOCOL_VERSION},"page":"watch"}}}}"#
    );
    assert_eq!(
        parsed(&answer(&request))["result"],
        parsed(&hello_reply(MIN_PROTOCOL_VERSION, PROTOCOL_VERSION))["result"]
    );
}

#[test]
fn a_write_is_not_answered_to_a_watch() {
    let reply = parsed(&answer(r#"{"id":2,"method":"settings.set","params":{}}"#));
    assert!(reply["error"].is_string());
}
