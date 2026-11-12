//! The linked browsers, as the settings screen reads and edits them.

use super::error::{VeloqError, engine_refused, with_reader};
use crate::persistence::linked_devices::{self, LinkedDevice};
use std::sync::Arc;

fn db(error: rusqlite::Error) -> VeloqError {
    VeloqError::Database {
        msg: error.to_string(),
    }
}

#[derive(uniffi::Object)]
pub struct RemoteManager {
    pub(crate) _private: (),
}

#[uniffi::export]
impl RemoteManager {
    #[uniffi::constructor]
    fn new() -> Arc<Self> {
        Arc::new(Self { _private: () })
    }

    /// Every linked browser, most recently linked first.
    fn list_linked_devices(&self) -> Result<Vec<LinkedDevice>, VeloqError> {
        let connections = crate::remote::service::connections();
        with_reader(|conn| linked_devices::list(conn, &connections).map_err(db))?
    }

    /// Unlink a browser so it can never reconnect, and end its connection
    /// if it has one. Written on the connection no engine lock stands in
    /// front of: an unlink is a tap, and must not wait behind a sync batch.
    /// Returns whether one was removed.
    fn remove_linked_device(&self, id: String) -> Result<bool, VeloqError> {
        let (fingerprint, removed) =
            crate::persistence::settings_conn::with_settings_conn(|conn| {
                let fingerprint = linked_devices::fingerprint_of(conn, &id)?;
                linked_devices::remove(conn, &id).map(|removed| (fingerprint, removed))
            })
            .ok_or_else(engine_refused)?
            .map_err(db)?;
        if let Some(fingerprint) = fingerprint {
            crate::remote::service::disconnect(Some(&fingerprint));
        }
        Ok(removed)
    }

    /// Answer a linked browser's connection offer and serve its requests.
    /// Refused for a browser that is not linked. Returns the answer, as the
    /// JSON the browser sets as its remote description.
    fn accept_offer(&self, offer: String) -> Result<String, VeloqError> {
        use crate::remote::peer::Refusal;
        crate::remote::service::accept_offer(&offer).map_err(|refusal| match refusal {
            Refusal::NotPinned => VeloqError::NotFound {
                msg: "this browser is not linked".into(),
            },
            Refusal::Malformed(msg) => VeloqError::ParseError { msg },
            Refusal::Network(msg) | Refusal::Engine(msg) => VeloqError::Database { msg },
        })
    }

    /// The relay rooms the phone waits in while open, one for each linked
    /// browser. Empty when none is linked, so the app never reaches the relay.
    fn linked_rooms(&self) -> Result<Vec<String>, VeloqError> {
        crate::remote::service::linked_rooms().map_err(|msg| VeloqError::Database { msg })
    }

    /// End every linked browser's connection.
    fn disconnect_all(&self) {
        crate::remote::service::disconnect(None);
    }

    /// Say whether the app is in front. A linked browser's write is answered
    /// only while it is; reads are answered either way.
    fn set_in_front(&self, in_front: bool) {
        crate::remote::service::set_in_front(in_front);
    }

    /// How many linked browsers are connected now, for the connected badge.
    fn connected_count(&self) -> u32 {
        crate::remote::service::connected_count()
    }

    /// Open a pairing from the QR code a browser shows. Returns the room the
    /// browser waits in. Refused for a code that is malformed, expired or
    /// already used.
    fn begin_pairing(&self, qr: String) -> Result<String, VeloqError> {
        crate::remote::service::begin_pairing(&qr).map_err(|refusal| VeloqError::ParseError {
            msg: format!("pairing refused: {refusal:?}"),
        })
    }

    /// The name a proved browser gave itself, while it waits for the athlete
    /// to accept or decline it. None when nothing is waiting.
    fn pairing_request(&self) -> Option<String> {
        crate::remote::service::pairing_request()
    }

    /// The athlete's answer to the pairing prompt. Accepting links the
    /// browser; declining ends its connection. Returns whether one was linked.
    fn confirm_pairing(&self, accept: bool) -> Result<bool, VeloqError> {
        crate::remote::service::confirm_pairing(accept).map_err(|msg| VeloqError::Database { msg })
    }

    /// Close the open pairing, ending its connection if it was not linked.
    fn cancel_pairing(&self) {
        crate::remote::service::cancel_pairing();
    }
}
