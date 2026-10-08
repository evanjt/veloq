use super::insights_week_bounds;

#[test]
fn test_insights_week_bounds_match_elapsed_week_and_four_week_chronic_window() {
    let tuesday_at_eight = 1_789_344_000 + 86_400 + 8 * 3600;
    let (current_start, current_end, prev_start, prev_end, chronic_start) =
        insights_week_bounds(tuesday_at_eight);

    assert_eq!(current_end, tuesday_at_eight);
    assert_eq!(current_start - prev_start, 7 * 86_400);
    assert_eq!(prev_end - prev_start, current_end - current_start);
    assert_eq!(prev_start - chronic_start, 28 * 86_400);
}
