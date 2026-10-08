use super::hr_zone_number;

const SETTINGS: &str = r#"[
    {"types":["Ride"],"max_hr":200,"hr_zones":[120,135,155,175,200]},
    {"other":true,"max_hr":195,"hr_zones":[146,155,165,175,192]}
]"#;

#[test]
fn test_hr_zone_number_unlisted_sport_uses_other_bounds() {
    assert_eq!(hr_zone_number(Some(SETTINGS), "Walk", 150.0), Some(2));
    assert_eq!(hr_zone_number(Some(SETTINGS), "Ride", 150.0), Some(3));
}
