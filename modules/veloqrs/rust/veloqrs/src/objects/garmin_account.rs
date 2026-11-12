//! What Garmin's account says about the key the athlete connected: the name on
//! it, and the id Garmin keeps for it. Nothing is stored here: the name is
//! shown and dropped, and the id is handed to the app, which keeps the
//! library's identity.

/// The account behind the key Garmin accepted.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, uniffi::Record)]
#[serde(rename_all = "camelCase")]
pub struct GarminAccount {
    /// The name Garmin gives the account, when its settings name one.
    pub display_name: Option<String>,
    /// The id Garmin keeps for the account, when the key's token or the
    /// account settings carry one.
    pub account_id: Option<String>,
}

/// The account behind the key held in this process, or `None` when no key is
/// held.
pub(crate) async fn garmin_account() -> Option<GarminAccount> {
    let client = super::garmin_key::GARMIN_KEY.client()?;
    let (tx, rx) = tokio::sync::oneshot::channel();
    crate::runtime::spawn(async move {
        let display_name = client
            .display_name(crate::net::garmin::dispatch())
            .await
            .ok()
            .flatten();
        let account_id = client
            .account_id(crate::net::garmin::dispatch())
            .await
            .ok()
            .flatten();
        let _ = tx.send(GarminAccount {
            display_name,
            account_id,
        });
    });
    rx.await.ok()
}
