//! Writes a line as a FIT course file: `file_id` of type course, the `course`
//! name and sport, one `lap` over the whole line, a start and an end `event`,
//! one `record` per point with position, altitude and accumulated distance,
//! and a `course_point` at the start and at the finish. A device that
//! navigates a course reads the line from the `record` messages.

use crate::GpsPoint;
use crate::fit_write::{
    BASE_ENUM, BASE_SINT32, BASE_STRING, BASE_UINT16, BASE_UINT32, FIT_EPOCH_UNIX, INVALID_SINT32,
    INVALID_UINT16, INVALID_UINT32, definition, wrap,
};

const MESG_FILE_ID: u16 = 0;
const MESG_LAP: u16 = 19;
const MESG_RECORD: u16 = 20;
const MESG_EVENT: u16 = 21;
const MESG_COURSE: u16 = 31;
const MESG_COURSE_POINT: u16 = 32;

/// The profile's development manufacturer, and the product number this app
/// writes under it.
const MANUFACTURER_DEVELOPMENT: u16 = 255;
const PRODUCT_ID: u16 = 1;
const APP_NAME: &str = "Veloq";

/// The profile's `file` type for a course.
const FILE_TYPE_COURSE: u8 = 6;
/// The profile's `course_point` type for a point with no further meaning.
const COURSE_POINT_GENERIC: u8 = 0;
/// The profile's `event` timer and its start and stop-all event types.
const EVENT_TIMER: u8 = 0;
const EVENT_START: u8 = 0;
const EVENT_STOP_ALL: u8 = 4;

/// The longest name written, in bytes. The profile's course name is a string
/// of 16 or more bytes, and readers accept 32.
const NAME_BYTES: usize = 32;

/// Seconds between one point's timestamp and the next. A course has no
/// recorded time, and a reader orders its points by timestamp.
const POINT_SPACING_SECS: i64 = 1;

/// A line to write as a course.
#[derive(Debug, Clone)]
pub struct CourseLine<'a> {
    pub name: &'a str,
    /// The sport as the app names it, such as `Ride` or `Run`.
    pub sport: Option<&'a str>,
    pub points: &'a [GpsPoint],
    /// Written time of the first point, seconds since the Unix epoch.
    pub start_unix: i64,
}

/// The profile's `sport` number for a sport as the app names it; 0 is generic.
pub fn fit_sport(sport: Option<&str>) -> u8 {
    sport.map_or(0, |name| crate::sport::to_fit(name).0)
}

impl CourseLine<'_> {
    /// The points a record can hold: those with a finite position.
    fn finite_points(&self) -> Vec<&GpsPoint> {
        self.points
            .iter()
            .filter(|p| p.latitude.is_finite() && p.longitude.is_finite())
            .collect()
    }

    fn fit_time(&self, index: usize) -> u32 {
        (self.start_unix + index as i64 * POINT_SPACING_SECS - FIT_EPOCH_UNIX)
            .clamp(0, i64::from(u32::MAX - 1)) as u32
    }

    /// The FIT file bytes, or `None` when fewer than two points have a
    /// position, which is not a line.
    pub fn to_fit(&self) -> Option<Vec<u8>> {
        let points = self.finite_points();
        if points.len() < 2 {
            return None;
        }
        let mut distances = Vec::with_capacity(points.len());
        let mut total = 0.0;
        distances.push(total);
        for pair in points.windows(2) {
            total += crate::persistence::haversine_distance_meters(
                pair[0].latitude,
                pair[0].longitude,
                pair[1].latitude,
                pair[1].longitude,
            );
            distances.push(total);
        }

        let mut data = Vec::new();
        self.write_identity(&mut data);
        self.write_event(&mut data, 0, EVENT_START);
        self.write_lap(&mut data, &points, total);
        self.write_records(&mut data, &points, &distances);
        self.write_course_points(&mut data, &points, total);
        self.write_event(&mut data, points.len() - 1, EVENT_STOP_ALL);
        Some(wrap(data))
    }

    fn write_identity(&self, out: &mut Vec<u8>) {
        let name = name_field(APP_NAME);
        definition(
            out,
            0,
            MESG_FILE_ID,
            &[
                (0, 1, BASE_ENUM),
                (1, 2, BASE_UINT16),
                (2, 2, BASE_UINT16),
                (4, 4, BASE_UINT32),
                (8, name.len() as u8, BASE_STRING),
            ],
        );
        out.push(0);
        out.push(FILE_TYPE_COURSE);
        out.extend_from_slice(&MANUFACTURER_DEVELOPMENT.to_le_bytes());
        out.extend_from_slice(&PRODUCT_ID.to_le_bytes());
        out.extend_from_slice(&self.fit_time(0).to_le_bytes());
        out.extend_from_slice(&name);

        let course_name = name_field(self.name);
        definition(
            out,
            1,
            MESG_COURSE,
            &[(4, 1, BASE_ENUM), (5, course_name.len() as u8, BASE_STRING)],
        );
        out.push(1);
        out.push(fit_sport(self.sport));
        out.extend_from_slice(&course_name);
    }

    fn write_event(&self, out: &mut Vec<u8>, index: usize, event_type: u8) {
        definition(
            out,
            2,
            MESG_EVENT,
            &[(253, 4, BASE_UINT32), (0, 1, BASE_ENUM), (1, 1, BASE_ENUM)],
        );
        out.push(2);
        out.extend_from_slice(&self.fit_time(index).to_le_bytes());
        out.push(EVENT_TIMER);
        out.push(event_type);
    }

    fn write_lap(&self, out: &mut Vec<u8>, points: &[&GpsPoint], total: f64) {
        let last = points.len() - 1;
        let elapsed = scaled_u32(last as f64 * POINT_SPACING_SECS as f64 * 1000.0);
        definition(
            out,
            3,
            MESG_LAP,
            &[
                (253, 4, BASE_UINT32),
                (2, 4, BASE_UINT32),
                (3, 4, BASE_SINT32),
                (4, 4, BASE_SINT32),
                (5, 4, BASE_SINT32),
                (6, 4, BASE_SINT32),
                (7, 4, BASE_UINT32),
                (8, 4, BASE_UINT32),
                (9, 4, BASE_UINT32),
            ],
        );
        out.push(3);
        out.extend_from_slice(&self.fit_time(last).to_le_bytes());
        out.extend_from_slice(&self.fit_time(0).to_le_bytes());
        for point in [points[0], points[last]] {
            out.extend_from_slice(&semicircles(point.latitude).to_le_bytes());
            out.extend_from_slice(&semicircles(point.longitude).to_le_bytes());
        }
        out.extend_from_slice(&elapsed.to_le_bytes());
        out.extend_from_slice(&elapsed.to_le_bytes());
        out.extend_from_slice(&scaled_u32(total * 100.0).to_le_bytes());
    }

    fn write_records(&self, out: &mut Vec<u8>, points: &[&GpsPoint], distances: &[f64]) {
        definition(
            out,
            4,
            MESG_RECORD,
            &[
                (253, 4, BASE_UINT32),
                (0, 4, BASE_SINT32),
                (1, 4, BASE_SINT32),
                (2, 2, BASE_UINT16),
                (5, 4, BASE_UINT32),
            ],
        );
        for (index, (point, distance)) in points.iter().zip(distances).enumerate() {
            out.push(4);
            out.extend_from_slice(&self.fit_time(index).to_le_bytes());
            out.extend_from_slice(&semicircles(point.latitude).to_le_bytes());
            out.extend_from_slice(&semicircles(point.longitude).to_le_bytes());
            out.extend_from_slice(&altitude_field(point.elevation).to_le_bytes());
            out.extend_from_slice(&scaled_u32(distance * 100.0).to_le_bytes());
        }
    }

    fn write_course_points(&self, out: &mut Vec<u8>, points: &[&GpsPoint], total: f64) {
        let last = points.len() - 1;
        let start = name_field("Start");
        let finish = name_field("Finish");
        // One definition holds both names, so both are padded to one size.
        let size = start.len().max(finish.len());
        definition(
            out,
            5,
            MESG_COURSE_POINT,
            &[
                (1, 4, BASE_UINT32),
                (2, 4, BASE_SINT32),
                (3, 4, BASE_SINT32),
                (4, 4, BASE_UINT32),
                (5, 1, BASE_ENUM),
                (6, size as u8, BASE_STRING),
            ],
        );
        for (index, distance, name) in [(0, 0.0, &start), (last, total, &finish)] {
            out.push(5);
            out.extend_from_slice(&self.fit_time(index).to_le_bytes());
            out.extend_from_slice(&semicircles(points[index].latitude).to_le_bytes());
            out.extend_from_slice(&semicircles(points[index].longitude).to_le_bytes());
            out.extend_from_slice(&scaled_u32(distance * 100.0).to_le_bytes());
            out.push(COURSE_POINT_GENERIC);
            out.extend_from_slice(name);
            out.extend(std::iter::repeat_n(0, size - name.len()));
        }
    }
}

/// A name cut to the bytes a reader accepts at a character boundary, with its
/// closing zero byte.
fn name_field(name: &str) -> Vec<u8> {
    let mut end = name.len().min(NAME_BYTES - 1);
    while !name.is_char_boundary(end) {
        end -= 1;
    }
    let mut bytes = name.as_bytes()[..end].to_vec();
    bytes.push(0);
    bytes
}

fn semicircles(degrees: f64) -> i32 {
    let value = (degrees * (2_147_483_648.0 / 180.0)).round();
    if value.is_finite() {
        value.clamp(f64::from(i32::MIN), f64::from(INVALID_SINT32 - 1)) as i32
    } else {
        INVALID_SINT32
    }
}

/// The profile's altitude: scaled by 5, offset by 500 m.
fn altitude_field(elevation: Option<f64>) -> u16 {
    match elevation {
        Some(m) if m.is_finite() => ((m + 500.0) * 5.0).round().clamp(0.0, 65_534.0) as u16,
        _ => INVALID_UINT16,
    }
}

fn scaled_u32(value: f64) -> u32 {
    if value.is_finite() {
        value.round().clamp(0.0, f64::from(u32::MAX - 1)) as u32
    } else {
        INVALID_UINT32
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::fit_write::crc;

    fn climb() -> Vec<GpsPoint> {
        (0..6)
            .map(|i| GpsPoint {
                latitude: 46.500 + f64::from(i) * 0.001,
                longitude: 6.600 + f64::from(i) * 0.0005,
                elevation: Some(400.0 + f64::from(i) * 3.5),
            })
            .collect()
    }

    fn line_length(points: &[GpsPoint]) -> f64 {
        points
            .windows(2)
            .map(|p| {
                crate::persistence::haversine_distance_meters(
                    p[0].latitude,
                    p[0].longitude,
                    p[1].latitude,
                    p[1].longitude,
                )
            })
            .sum()
    }

    fn decode(file: &[u8]) -> Vec<fitparser::FitDataRecord> {
        fitparser::from_bytes(file).expect("the file decodes")
    }

    fn number(record: &fitparser::FitDataRecord, field: &str) -> Option<f64> {
        record
            .fields()
            .iter()
            .find(|f| f.name() == field)
            .and_then(|f| match f.value() {
                fitparser::Value::Float64(v) => Some(*v),
                fitparser::Value::Float32(v) => Some(f64::from(*v)),
                fitparser::Value::SInt32(v) => Some(f64::from(*v)),
                fitparser::Value::UInt32(v) => Some(f64::from(*v)),
                fitparser::Value::UInt16(v) => Some(f64::from(*v)),
                _ => None,
            })
    }

    fn of_kind<'a>(
        records: &'a [fitparser::FitDataRecord],
        kind: fitparser::profile::MesgNum,
    ) -> Vec<&'a fitparser::FitDataRecord> {
        records.iter().filter(|r| r.kind() == kind).collect()
    }

    fn written(points: &[GpsPoint]) -> Vec<u8> {
        CourseLine {
            name: "Col test",
            sport: Some("Ride"),
            points,
            start_unix: 1_773_471_600,
        }
        .to_fit()
        .expect("a course")
    }

    /// Scenario: a section's line is written as a course for a watch.
    /// Expected behaviour: the file is of type course, holds one record per
    /// point with its altitude, and ends at the line's length.
    #[test]
    fn a_course_has_a_record_per_point_with_altitude_and_the_line_length() {
        use fitparser::profile::MesgNum;
        let points = climb();
        let records = decode(&written(&points));

        let id = of_kind(&records, MesgNum::FileId);
        let file_type = id[0].fields().iter().find(|f| f.name() == "type").unwrap();
        assert_eq!(file_type.value().to_string(), "course");

        let rows = of_kind(&records, MesgNum::Record);
        assert_eq!(rows.len(), points.len());
        for (row, point) in rows.iter().zip(&points) {
            let altitude = number(row, "enhanced_altitude").expect("altitude on every record");
            assert!(
                (altitude - point.elevation.unwrap()).abs() < 0.2,
                "{altitude}"
            );
        }
        let end = number(rows[rows.len() - 1], "distance").unwrap();
        assert!((end - line_length(&points)).abs() < 1.0, "{end}");
        assert_eq!(number(rows[0], "distance"), Some(0.0));
    }

    #[test]
    fn the_course_carries_its_name_sport_lap_and_two_course_points() {
        use fitparser::profile::MesgNum;
        let points = climb();
        let records = decode(&written(&points));

        let course = of_kind(&records, MesgNum::Course);
        let name = course[0].fields().iter().find(|f| f.name() == "name");
        assert_eq!(name.unwrap().value().to_string(), "Col test");

        let lap = of_kind(&records, MesgNum::Lap);
        let total = number(lap[0], "total_distance").unwrap();
        assert!((total - line_length(&points)).abs() < 1.0, "{total}");

        let marks = of_kind(&records, MesgNum::CoursePoint);
        assert_eq!(marks.len(), 2);
        let last = number(marks[1], "distance").unwrap();
        assert!((last - line_length(&points)).abs() < 1.0, "{last}");
    }

    #[test]
    fn a_point_without_elevation_writes_no_altitude() {
        use fitparser::profile::MesgNum;
        let mut points = climb();
        points[2].elevation = None;
        let records = decode(&written(&points));
        let rows = of_kind(&records, MesgNum::Record);
        assert_eq!(rows.len(), points.len());
        assert!(number(rows[2], "enhanced_altitude").is_none());
        assert!(number(rows[3], "enhanced_altitude").is_some());
    }

    #[test]
    fn a_line_with_under_two_positioned_points_is_not_a_course() {
        let mut points = climb();
        points.truncate(1);
        let line = |points: &[GpsPoint]| {
            CourseLine {
                name: "x",
                sport: None,
                points,
                start_unix: 0,
            }
            .to_fit()
        };
        assert!(line(&points).is_none());
        points.push(GpsPoint {
            latitude: f64::NAN,
            longitude: 6.6,
            elevation: None,
        });
        assert!(line(&points).is_none());
    }

    #[test]
    fn a_long_multibyte_name_is_cut_on_a_character_boundary() {
        let name = "é".repeat(40);
        let field = name_field(&name);
        assert!(field.len() <= NAME_BYTES);
        assert_eq!(field.last(), Some(&0));
        assert!(std::str::from_utf8(&field[..field.len() - 1]).is_ok());
    }

    #[test]
    fn the_file_passes_the_header_and_crc_checks() {
        let file = written(&climb());
        let data_size = u32::from_le_bytes(file[4..8].try_into().unwrap()) as usize;
        assert_eq!(file.len(), 14 + data_size + 2);
        let body = file.len() - 2;
        assert_eq!(
            u16::from_le_bytes(file[body..].try_into().unwrap()),
            crc(&file[..body])
        );
    }

    #[test]
    fn sports_map_to_the_profile_numbers() {
        assert_eq!(fit_sport(Some("Ride")), 2);
        assert_eq!(fit_sport(Some("TrailRun")), 1);
        assert_eq!(fit_sport(Some("Unlisted")), 0);
        assert_eq!(fit_sport(None), 0);
    }
}
