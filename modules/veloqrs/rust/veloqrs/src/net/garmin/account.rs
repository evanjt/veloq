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

/// The keys that name the account in a token's claims or in Garmin's settings
/// answer, most trusted first. A token's subject outranks everything: it is
/// the claim an issuer keeps fixed for an account.
const ACCOUNT_ID_KEYS: [&str; 5] = ["sub", "userId", "user_id", "userProfilePk", "userProfileId"];

/// The account id the first of [`ACCOUNT_ID_KEYS`] present at the top level
/// names, as text. A blank string, a zero and a value that is neither text nor
/// a whole number name nothing, so a placeholder never becomes an identity.
pub(crate) fn account_id_in(value: &serde_json::Value) -> Option<String> {
    let map = value.as_object()?;
    ACCOUNT_ID_KEYS.iter().find_map(|key| match map.get(*key)? {
        serde_json::Value::String(id) if !id.trim().is_empty() => Some(id.trim().to_string()),
        serde_json::Value::Number(id) => id.as_u64().filter(|n| *n > 0).map(|n| n.to_string()),
        _ => None,
    })
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

    #[test]
    fn the_account_id_is_the_token_subject_before_any_other_key() {
        let claims = json!({"sub": " 8f2c-invented ", "userId": 41, "exp": 1});
        assert_eq!(account_id_in(&claims).as_deref(), Some("8f2c-invented"));
        assert_eq!(account_id_in(&json!({"userId": 41})).as_deref(), Some("41"));
        assert_eq!(
            account_id_in(&json!({"userProfilePk": "77"})).as_deref(),
            Some("77")
        );
    }

    #[test]
    fn a_blank_zero_or_non_scalar_account_id_names_nobody() {
        assert_eq!(account_id_in(&json!({"sub": "  "})), None);
        assert_eq!(account_id_in(&json!({"userId": 0})), None);
        assert_eq!(account_id_in(&json!({"userId": -3})), None);
        assert_eq!(account_id_in(&json!({"userId": 1.5})), None);
        assert_eq!(account_id_in(&json!({"userId": {"id": 4}})), None);
        assert_eq!(account_id_in(&json!(["sub"])), None);
        assert_eq!(account_id_in(&json!(null)), None);
    }
}
