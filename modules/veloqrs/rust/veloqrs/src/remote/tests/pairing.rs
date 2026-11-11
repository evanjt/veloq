//! The pairing rule as a pure function of the invitation, both certificates,
//! the proof, the time and the secrets already spent.

use super::*;
use std::collections::HashSet;

const BROWSER: &str = "sha-256 AA:AA";
const PHONE: &str = "sha-256 BB:BB";
const NOW: i64 = 1_700_000_000;

fn invitation() -> Invitation {
    let qr = format!(
        r#"{{"v":1,"room":"room-0123456789abcdefghij","secret":"{}","fp":"SHA-256 aa:aa","exp":{}}}"#,
        encode_secret(&[7u8; 32]),
        NOW + 60
    );
    Invitation::parse(&qr, NOW).expect("a good invitation")
}

fn browser_proof(invitation: &Invitation, phone: &str) -> Vec<u8> {
    proof(
        &invitation.secret,
        Role::Browser,
        &invitation.browser,
        phone,
    )
    .to_vec()
}

#[test]
fn a_good_pairing_is_accepted_once() {
    let invitation = invitation();
    let mut spent = HashSet::new();
    let proof = browser_proof(&invitation, PHONE);
    assert_eq!(
        verify(&invitation, BROWSER, PHONE, &proof, NOW, &mut spent),
        Ok(())
    );
    assert_eq!(
        verify(&invitation, BROWSER, PHONE, &proof, NOW, &mut spent),
        Err(PairingRefusal::Spent)
    );
}

#[test]
fn an_expired_invitation_is_refused() {
    let invitation = invitation();
    let proof = browser_proof(&invitation, PHONE);
    assert_eq!(
        verify(
            &invitation,
            BROWSER,
            PHONE,
            &proof,
            NOW + 61,
            &mut HashSet::new()
        ),
        Err(PairingRefusal::Expired)
    );
}

#[test]
fn another_browser_presenting_the_secret_is_refused() {
    let invitation = invitation();
    let proof = browser_proof(&invitation, PHONE);
    assert_eq!(
        verify(
            &invitation,
            "sha-256 CC:CC",
            PHONE,
            &proof,
            NOW,
            &mut HashSet::new()
        ),
        Err(PairingRefusal::WrongBrowser)
    );
}

#[test]
fn a_proof_made_over_a_swapped_phone_certificate_is_refused() {
    let invitation = invitation();
    let proof = browser_proof(&invitation, "sha-256 DD:DD");
    assert_eq!(
        verify(
            &invitation,
            BROWSER,
            PHONE,
            &proof,
            NOW,
            &mut HashSet::new()
        ),
        Err(PairingRefusal::BadProof)
    );
}

#[test]
fn a_wrong_proof_spends_the_secret() {
    let invitation = invitation();
    let mut spent = HashSet::new();
    assert_eq!(
        verify(&invitation, BROWSER, PHONE, &[0u8; 32], NOW, &mut spent),
        Err(PairingRefusal::BadProof)
    );
    let good = browser_proof(&invitation, PHONE);
    assert_eq!(
        verify(&invitation, BROWSER, PHONE, &good, NOW, &mut spent),
        Err(PairingRefusal::Spent)
    );
}

#[test]
fn a_truncated_or_padded_proof_is_refused() {
    let invitation = invitation();
    let good = browser_proof(&invitation, PHONE);
    let mut padded = good.clone();
    padded.push(0);
    for given in [&good[..31], &padded[..], &[][..]] {
        assert_eq!(
            verify(&invitation, BROWSER, PHONE, given, NOW, &mut HashSet::new()),
            Err(PairingRefusal::BadProof)
        );
    }
}

#[test]
fn the_phone_proof_differs_from_the_browser_proof() {
    let invitation = invitation();
    let browser = proof(&invitation.secret, Role::Browser, BROWSER, PHONE);
    let phone = proof(&invitation.secret, Role::Phone, BROWSER, PHONE);
    assert_ne!(browser, phone);
}

#[test]
fn an_invitation_lasting_past_the_cap_is_cut_to_it() {
    let qr = format!(
        r#"{{"v":1,"room":"room-0123456789abcdefghij","secret":"{}","fp":"sha-256 AA:AA","exp":{}}}"#,
        encode_secret(&[7u8; 32]),
        NOW + 86_400
    );
    let invitation = Invitation::parse(&qr, NOW).unwrap();
    assert_eq!(invitation.expires_at, NOW + PAIRING_TTL_SECS);
}

#[test]
fn malformed_and_stale_invitations_are_refused() {
    assert_eq!(
        Invitation::parse("nope", NOW).err(),
        Some(PairingRefusal::Malformed)
    );
    let short = format!(
        r#"{{"v":1,"room":"room-0123456789abcdefghij","secret":"{}","fp":"sha-256 AA:AA","exp":{}}}"#,
        encode_secret(&[7u8; 8]),
        NOW + 60
    );
    assert_eq!(
        Invitation::parse(&short, NOW).err(),
        Some(PairingRefusal::Malformed)
    );
    let stale = format!(
        r#"{{"v":1,"room":"room-0123456789abcdefghij","secret":"{}","fp":"sha-256 AA:AA","exp":{}}}"#,
        encode_secret(&[7u8; 32]),
        NOW - 1
    );
    assert_eq!(
        Invitation::parse(&stale, NOW).err(),
        Some(PairingRefusal::Expired)
    );
}

fn prove_params(invitation: &Invitation, phone: &str, name: &str) -> serde_json::Value {
    serde_json::json!({
        "proof": encode_secret(&browser_proof(invitation, phone)),
        "name": name,
    })
}

#[test]
fn a_proved_browser_is_linked_only_once_the_athlete_accepts() {
    let mut pairing = Pairing::new(invitation());
    let mut spent = HashSet::new();
    assert!(pairing.admits(BROWSER, NOW));
    assert!(!pairing.admits("sha-256 CC:CC", NOW));

    let params = prove_params(&pairing.invitation, PHONE, " Firefox on Linux ");
    let reply = pairing
        .answer(BROWSER, PHONE, "pair.prove", params, NOW, &mut spent)
        .expect("proved");
    let expected = proof(&pairing.invitation.secret, Role::Phone, BROWSER, PHONE);
    assert_eq!(reply["phoneProof"], encode_secret(&expected));
    assert_eq!(pairing.asking(), Some("Firefox on Linux"));
    assert_eq!(
        pairing.answer(
            BROWSER,
            PHONE,
            "pair.status",
            serde_json::Value::Null,
            NOW,
            &mut spent
        ),
        Ok(serde_json::json!("waiting"))
    );

    assert_eq!(
        pairing.confirm(true),
        Some(("Firefox on Linux".to_owned(), BROWSER.to_owned()))
    );
    assert_eq!(pairing.confirm(true), None);
    assert_eq!(
        pairing.answer(
            BROWSER,
            PHONE,
            "pair.status",
            serde_json::Value::Null,
            NOW,
            &mut spent
        ),
        Ok(serde_json::json!("confirmed"))
    );
}

#[test]
fn a_declined_browser_is_not_linked_and_is_shut_out() {
    let mut pairing = Pairing::new(invitation());
    let mut spent = HashSet::new();
    let params = prove_params(&pairing.invitation, PHONE, "");
    pairing
        .answer(BROWSER, PHONE, "pair.prove", params, NOW, &mut spent)
        .unwrap();
    assert_eq!(pairing.asking(), Some("Browser"));
    assert_eq!(pairing.confirm(false), None);
    assert!(!pairing.admits(BROWSER, NOW));
}

#[test]
fn nothing_is_asked_or_linked_before_a_proof() {
    let mut pairing = Pairing::new(invitation());
    assert_eq!(pairing.asking(), None);
    assert_eq!(pairing.confirm(true), None);
    assert!(!pairing.admits(BROWSER, NOW + PAIRING_TTL_SECS + 1));
}

#[test]
fn a_refused_proof_closes_the_pairing() {
    let mut pairing = Pairing::new(invitation());
    let mut spent = HashSet::new();
    let params = serde_json::json!({ "proof": encode_secret(&[0u8; 32]) });
    assert!(
        pairing
            .answer(BROWSER, PHONE, "pair.prove", params, NOW, &mut spent)
            .is_err()
    );
    assert_eq!(pairing.stage, Stage::Refused(PairingRefusal::BadProof));
    assert!(!pairing.admits(BROWSER, NOW));
    assert_eq!(pairing.confirm(true), None);
}

#[test]
fn a_linked_pair_meets_in_a_room_the_relay_takes() {
    let room = room_for(BROWSER, PHONE);
    assert!(crate::remote::is_room_id(&room), "{room}");
    assert_eq!(room, room_for(BROWSER, PHONE));
}

#[test]
fn each_linked_browser_has_its_own_room() {
    let room = room_for(BROWSER, PHONE);
    assert_ne!(room, room_for("sha-256 CC:CC", PHONE));
    assert_ne!(room, room_for(BROWSER, "sha-256 CC:CC"));
    assert_ne!(room, room_for(PHONE, BROWSER));
}

#[test]
fn the_room_pins_the_derivation_the_web_page_repeats() {
    // The page computes the same id with SubtleCrypto, so the bytes hashed are fixed.
    assert_eq!(
        room_for(BROWSER, PHONE),
        "lD6s7KZ5brFE6GjE1k-PwiGY80A1aFGhYeKG78_Kp9k"
    );
}
