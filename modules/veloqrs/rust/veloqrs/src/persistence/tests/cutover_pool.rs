#[test]
fn test_has_unprocessed_activity_net_zero_swap() {
    let processed = vec!["ride_a".to_string(), "ride_b".to_string()];
    let current = vec!["ride_b".to_string(), "ride_c".to_string()];

    assert!(super::has_unprocessed_activity(&current, &processed));
    assert!(!super::has_unprocessed_activity(&processed, &processed));
    assert!(!super::has_unprocessed_activity(&[], &processed));
}
