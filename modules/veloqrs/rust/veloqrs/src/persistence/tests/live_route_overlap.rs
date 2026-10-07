use super::*;

#[test]
fn test_live_overlap_half_track_and_parallel_route() {
    let route: Vec<GpsPoint> = (0..101)
        .map(|index| GpsPoint::new(47.0 + f64::from(index) * 0.0001, 7.0))
        .collect();
    let mut track = route.clone();
    track.extend((1..101).map(|index| GpsPoint::new(47.01, 7.0 + f64::from(index) * 0.00015)));
    let parallel: Vec<GpsPoint> = route
        .iter()
        .map(|point| GpsPoint::new(point.latitude, point.longitude - 0.0027))
        .collect();

    let config = tracematch::MatchConfig::default();
    let overlap = live_overlap_percentage(&track, &route, &config);
    let distant = live_overlap_percentage(&track, &parallel, &config);
    assert!((45.0..=55.0).contains(&overlap), "overlap was {overlap}");
    assert!(distant < 5.0, "parallel overlap was {distant}");
}
