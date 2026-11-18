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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
fn the_phone_proof_differs_from_the_browser_proof() {
    let invitation = invitation();
    let browser = proof(&invitation.secret, Role::Browser, BROWSER, PHONE);
    let phone = proof(&invitation.secret, Role::Phone, BROWSER, PHONE);
    assert_ne!(browser, phone);
}

#[test]
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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
#[cfg_attr(not(feature = "vault"), ignore = "vault")]
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

const ROOM_SECRET: [u8; 32] = [9; 32];

#[test]
fn a_linked_pair_meets_in_a_room_the_relay_takes() {
    let room = room_for(&ROOM_SECRET, BROWSER, PHONE);
    assert!(crate::remote::is_room_id(&room), "{room}");
    assert_eq!(room, room_for(&ROOM_SECRET, BROWSER, PHONE));
}

#[test]
fn each_linked_browser_has_its_own_room() {
    let room = room_for(&ROOM_SECRET, BROWSER, PHONE);
    assert_ne!(room, room_for(&ROOM_SECRET, "sha-256 CC:CC", PHONE));
    assert_ne!(room, room_for(&ROOM_SECRET, BROWSER, "sha-256 CC:CC"));
    assert_ne!(room, room_for(&ROOM_SECRET, PHONE, BROWSER));
}

#[test]
fn a_room_cannot_be_computed_from_the_fingerprints_alone() {
    let room = room_for(&ROOM_SECRET, BROWSER, PHONE);
    assert_ne!(room, room_for(&[8; 32], BROWSER, PHONE));
}

#[test]
fn the_room_pins_the_derivation_the_web_page_repeats() {
    // The page computes the same ids with SubtleCrypto, so the bytes hashed are fixed.
    assert_eq!(
        room_for(&ROOM_SECRET, BROWSER, PHONE),
        "Taj32Mw-49FizxFKWRTJzY3saP8aUCeOkTovlalofhA"
    );
}

const VECTORS: &str = concat!(env!("CARGO_MANIFEST_DIR"), "/examples/link/vectors.json");

fn unhex(text: &str) -> Vec<u8> {
    (0..text.len())
        .step_by(2)
        .map(|at| u8::from_str_radix(&text[at..at + 2], 16).expect("hex"))
        .collect()
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn vectors() -> serde_json::Value {
    let text = std::fs::read_to_string(VECTORS)
        .unwrap_or_else(|error| panic!("{VECTORS} is not readable: {error}"));
    serde_json::from_str(&text).expect("the vectors are JSON")
}

#[test]
fn every_output_in_the_vectors_is_what_the_engine_derives_from_its_inputs() {
    let vectors = vectors();
    let text = |section: &str, key: &str| -> String {
        vectors[section][key]
            .as_str()
            .unwrap_or_else(|| panic!("{section}.{key} is a string"))
            .to_owned()
    };
    let browser = text("inputs", "browserFingerprint");
    let phone = text("inputs", "phoneFingerprint");
    let secret: [u8; 32] = unhex(&text("inputs", "secretHex"))
        .try_into()
        .expect("a 32-byte secret");

    assert_eq!(text("outputs", "room"), room_for(&secret, &browser, &phone));
    assert_eq!(
        text("outputs", "browserProof"),
        hex(&proof(&secret, Role::Browser, &browser, &phone))
    );
    assert_eq!(
        text("outputs", "phoneProof"),
        hex(&proof(&secret, Role::Phone, &browser, &phone))
    );
    assert_eq!(
        text("outputs", "fingerprint"),
        fingerprint_of(&unhex(&text("inputs", "certificateHex")))
    );

    for (reply, frames) in [("shortReply", "shortFrames"), ("longReply", "longFrames")] {
        let expected: Vec<String> = vectors["outputs"][frames]
            .as_array()
            .unwrap_or_else(|| panic!("outputs.{frames} is a list"))
            .iter()
            .map(|frame| frame.as_str().expect("hex").to_owned())
            .collect();
        let actual: Vec<String> = crate::remote::protocol::frames(&text("inputs", reply))
            .iter()
            .map(|frame| hex(frame))
            .collect();
        assert_eq!(expected, actual, "{frames}");
    }
}

#[test]
fn the_long_reply_is_over_the_gzip_threshold_and_the_short_one_is_not() {
    let vectors = vectors();
    let long = vectors["inputs"]["longReply"].as_str().expect("text");
    let short = vectors["inputs"]["shortReply"].as_str().expect("text");
    assert!(long.len() > crate::remote::protocol::GZIP_OVER);
    assert!(short.len() <= crate::remote::protocol::GZIP_OVER);
}

#[test]
fn the_committed_vectors_are_the_rendered_ones() {
    let rendered = crate::remote::vectors::vectors_json();
    let kept = std::fs::read_to_string(VECTORS).unwrap_or_default();
    assert!(
        kept == rendered,
        "examples/link/vectors.json is out of date; it should read:\n{rendered}"
    );
}
