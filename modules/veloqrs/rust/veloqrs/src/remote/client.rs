//! What a linked client says it is, read from its `link.hello`.
//!
//! The description is the client's own claim. A browser sends its user agent
//! and the phone reads the browser and system from it, a computer tool sends
//! its name and version. Nothing here is verified, and the screen that shows
//! it says so.

use super::protocol::FfiLinkClient;
use crate::persistence::linked_devices::Client;

/// The longest text kept for any one field.
const FIELD_LIMIT: usize = 64;

/// The longest user agent read.
const AGENT_LIMIT: usize = 512;

/// What the client says it is, or none when it names no kind the phone knows.
pub fn describe(client: &FfiLinkClient) -> Option<Client> {
    match client.kind.as_str() {
        "browser" => {
            let agent: String = client
                .user_agent
                .as_deref()
                .unwrap_or_default()
                .chars()
                .take(AGENT_LIMIT)
                .collect();
            Some(Client {
                kind: "browser".into(),
                browser: browser_of(&agent).map(str::to_owned),
                os: system_of(&agent).map(str::to_owned),
                tool: None,
                tool_version: None,
            })
        }
        "tool" => Some(Client {
            kind: "tool".into(),
            browser: None,
            os: None,
            tool: clean(client.tool.as_deref()),
            tool_version: clean(client.tool_version.as_deref()),
        }),
        _ => None,
    }
}

/// Text with control characters dropped and its length held, none when
/// nothing is left.
fn clean(text: Option<&str>) -> Option<String> {
    let kept: String = text?
        .chars()
        .filter(|c| !c.is_control())
        .take(FIELD_LIMIT)
        .collect();
    let kept = kept.trim();
    (!kept.is_empty()).then(|| kept.to_owned())
}

/// The browser a user agent names. The order matters: most browsers also
/// name the ones they are built on.
fn browser_of(agent: &str) -> Option<&'static str> {
    [
        ("Edg/", "Edge"),
        ("EdgA/", "Edge"),
        ("OPR/", "Opera"),
        ("Firefox/", "Firefox"),
        ("FxiOS/", "Firefox"),
        ("Chrome/", "Chrome"),
        ("CriOS/", "Chrome"),
        ("Safari/", "Safari"),
    ]
    .into_iter()
    .find(|(marker, _)| agent.contains(marker))
    .map(|(_, name)| name)
}

/// The system a user agent names.
fn system_of(agent: &str) -> Option<&'static str> {
    [
        ("Android", "Android"),
        ("iPhone", "iOS"),
        ("iPad", "iOS"),
        ("Windows", "Windows"),
        ("CrOS", "ChromeOS"),
        ("Mac OS X", "macOS"),
        ("Linux", "Linux"),
    ]
    .into_iter()
    .find(|(marker, _)| agent.contains(marker))
    .map(|(_, name)| name)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn browser(agent: &str) -> FfiLinkClient {
        FfiLinkClient {
            kind: "browser".into(),
            user_agent: Some(agent.into()),
            tool: None,
            tool_version: None,
        }
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_browsers_user_agent_names_its_browser_and_system() {
        let firefox = describe(&browser(
            "Mozilla/5.0 (X11; Linux x86_64; rv:130.0) Gecko/20100101 Firefox/130.0",
        ))
        .unwrap();
        assert_eq!(firefox.browser.as_deref(), Some("Firefox"));
        assert_eq!(firefox.os.as_deref(), Some("Linux"));

        let edge = describe(&browser(
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) \
             Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
        ))
        .unwrap();
        assert_eq!(edge.browser.as_deref(), Some("Edge"));
        assert_eq!(edge.os.as_deref(), Some("Windows"));

        let safari = describe(&browser(
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like \
             Gecko) Version/17.0 Safari/605.1.15",
        ))
        .unwrap();
        assert_eq!(safari.browser.as_deref(), Some("Safari"));
        assert_eq!(safari.os.as_deref(), Some("macOS"));
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn an_unrecognised_agent_is_still_a_browser_with_nothing_named() {
        let client = describe(&browser("curl-like")).unwrap();
        assert_eq!(client.kind, "browser");
        assert_eq!(client.browser, None);
        assert_eq!(client.os, None);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn a_tool_keeps_its_name_and_version_clean_and_short() {
        let tool = describe(&FfiLinkClient {
            kind: "tool".into(),
            user_agent: None,
            tool: Some("veloq-cli\n".into()),
            tool_version: Some("x".repeat(200)),
        })
        .unwrap();
        assert_eq!(tool.tool.as_deref(), Some("veloq-cli"));
        assert_eq!(tool.tool_version.unwrap().len(), FIELD_LIMIT);
    }

    #[test]
    #[cfg_attr(not(feature = "vault"), ignore = "vault")]
    fn an_unknown_kind_describes_nothing() {
        let client = FfiLinkClient {
            kind: "toaster".into(),
            user_agent: None,
            tool: None,
            tool_version: None,
        };
        assert_eq!(describe(&client), None);
    }
}
