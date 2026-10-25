//! What Garmin's account settings say about the account a key belongs to.

/// The account's name in Garmin's settings answer: the first `displayName`
/// that is text and not blank, at any depth, trimmed.
pub(crate) fn display_name_in(settings: &serde_json::Value) -> Option<String> {
    match settings {
        serde_json::Value::Object(map) => {
            let named = match map.get("displayName") {
                Some(serde_json::Value::String(name)) if !name.trim().is_empty() => {
                    Some(name.trim().to_string())
                }
                _ => None,
            };
            named.or_else(|| map.values().find_map(display_name_in))
        }
        serde_json::Value::Array(items) => items.iter().find_map(display_name_in),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn the_display_name_is_read_from_the_top_level() {
        let settings = json!({"displayName": "Invented Athlete", "locale": "en-GB"});
        assert_eq!(
            display_name_in(&settings).as_deref(),
            Some("Invented Athlete")
        );
    }

    #[test]
    fn the_display_name_is_found_under_a_nested_object_or_list() {
        let nested = json!({"userData": {"unitSystem": "metric"}, "profile": {"displayName": "Invented Athlete"}});
        assert_eq!(
            display_name_in(&nested).as_deref(),
            Some("Invented Athlete")
        );
        let listed = json!([{"locale": "en"}, {"displayName": "Invented Athlete"}]);
        assert_eq!(
            display_name_in(&listed).as_deref(),
            Some("Invented Athlete")
        );
    }

    #[test]
    fn a_blank_or_non_text_display_name_names_nothing() {
        assert_eq!(display_name_in(&json!({"displayName": "  "})), None);
        assert_eq!(display_name_in(&json!({"displayName": 12})), None);
        assert_eq!(display_name_in(&json!({"locale": "en"})), None);
        assert_eq!(display_name_in(&json!(null)), None);
    }

    #[test]
    fn the_display_name_is_trimmed() {
        assert_eq!(
            display_name_in(&json!({"displayName": "  Invented Athlete \n"})).as_deref(),
            Some("Invented Athlete")
        );
    }
}
