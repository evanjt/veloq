//! The phone's end of a watch link: a watch's request is a link request, and
//! the engine answers it, so the native side decides nothing about versions.

use super::protocol::{hello_answer, negotiate, refusal};
use crate::persistence::read_pool;
use serde_json::{Value, json};

/// The id a hello made from a version range alone carries.
const HELLO_ID: u64 = 0;

/// The answer to a watch that speaks versions `min` through `max`: the
/// highest version both hold, or the refusal naming both ranges.
#[must_use]
pub fn hello_reply(min: u32, max: u32) -> String {
    let request = json!({
        "id": HELLO_ID,
        "method": "link.hello",
        "params": { "protocol": max, "minProtocol": min, "page": "watch" },
    })
    .to_string();
    answer(&request)
}

/// Answer one link request from a watch. A request outside the version window
/// is refused, a hello is answered from the window, and any other method is
/// answered from a read: a write is unknown here.
#[must_use]
pub fn answer(request: &str) -> String {
    if let Some(refused) = refusal(request) {
        return refused;
    }
    let parsed: Value = serde_json::from_str(request).unwrap_or_default();
    if parsed["method"] == "link.hello" {
        let params = &parsed["params"];
        let max = params["protocol"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok());
        let min = params["minProtocol"]
            .as_u64()
            .and_then(|v| u32::try_from(v).ok())
            .or(max);
        if let (Some(min), Some(max)) = (min, max)
            && let Some(protocol) = negotiate(min, max)
        {
            let answer = hello_answer("", protocol);
            return json!({ "id": parsed["id"], "result": answer }).to_string();
        }
    }
    let caller = super::protocol::Caller::default();
    read_pool::with_read_conn(|conn| super::protocol::answer_from(conn, &caller, request))
        .unwrap_or_else(|| {
            json!({ "id": parsed["id"], "error": "engine not initialised" }).to_string()
        })
}

mod c {
    use std::ffi::{CStr, CString, c_char};

    /// Answer one link request, a NUL-terminated UTF-8 string, with a string
    /// the caller frees through `veloq_watch_free`. Null for a null request.
    #[unsafe(no_mangle)]
    pub extern "C" fn veloq_watch_answer(request: *const c_char) -> *mut c_char {
        crate::ffi_refuse_on_panic("watch answer", std::ptr::null_mut(), || {
            if request.is_null() {
                return std::ptr::null_mut();
            }
            // SAFETY: the caller passes a NUL-terminated string that outlives the call.
            let request = unsafe { CStr::from_ptr(request) }.to_string_lossy();
            CString::new(super::answer(&request)).map_or(std::ptr::null_mut(), CString::into_raw)
        })
    }

    /// The reply to a watch that speaks versions `min` through `max`, freed
    /// through `veloq_watch_free`.
    #[unsafe(no_mangle)]
    pub extern "C" fn veloq_watch_hello(min: u32, max: u32) -> *mut c_char {
        crate::ffi_refuse_on_panic("watch hello", std::ptr::null_mut(), || {
            CString::new(super::hello_reply(min, max))
                .map_or(std::ptr::null_mut(), CString::into_raw)
        })
    }

    /// Free a string `veloq_watch_answer` or `veloq_watch_hello` returned.
    #[unsafe(no_mangle)]
    pub extern "C" fn veloq_watch_free(reply: *mut c_char) {
        if reply.is_null() {
            return;
        }
        // SAFETY: the pointer came from `CString::into_raw` above and is freed once.
        drop(unsafe { CString::from_raw(reply) });
    }
}

#[cfg(test)]
#[path = "tests/watch.rs"]
mod tests;
