//! What Garmin's account says about the key the athlete connected: the name on
//! it. Nothing is stored: the name is shown and dropped.

/// The account behind the key Garmin accepted.
#[derive(Debug, Clone, PartialEq, Eq, uniffi::Record)]
pub struct GarminAccount {
    /// The name Garmin gives the account, when its settings name one.
    pub display_name: Option<String>,
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
        let _ = tx.send(GarminAccount { display_name });
    });
    rx.await.ok()
}
