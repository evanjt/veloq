//! A writer of activity FIT files built to the FIT profile, for tests that
//! need a ride or a run with the sensor streams and session totals a device
//! writes. Nothing here is read from an athlete's file: every number is
//! invented and the positions sit on an arbitrary meridian line.

/// Seconds from the Unix epoch to the FIT epoch, 1989-12-31T00:00:00Z.
pub(crate) const FIT_EPOCH_UNIX: i64 = 631_065_600;

const BASE_ENUM: u8 = 0x00;
const BASE_UINT8: u8 = 0x02;
const BASE_SINT32: u8 = 0x85;
const BASE_UINT16: u8 = 0x84;
const BASE_UINT32: u8 = 0x86;

const INVALID_UINT8: u8 = 0xFF;
const INVALID_UINT16: u16 = 0xFFFF;
const INVALID_UINT32: u32 = 0xFFFF_FFFF;
const INVALID_SINT32: i32 = 0x7FFF_FFFF;

/// One `record` message. A field left `None` is written as the FIT invalid
/// value, which is how a device writes a sensor it has no reading from.
#[derive(Debug, Clone, Default)]
pub(crate) struct Sample {
    /// Seconds after the ride's start.
    pub at: u32,
    pub position: Option<(f64, f64)>,
    pub altitude: Option<f64>,
    pub heart_rate: Option<u8>,
    pub cadence: Option<u8>,
    pub distance: Option<f64>,
    pub speed: Option<f64>,
    pub power: Option<u16>,
}

/// The session message's totals. `None` is written as invalid.
#[derive(Debug, Clone, Default)]
pub(crate) struct SessionTotals {
    pub elapsed_secs: Option<f64>,
    pub timer_secs: Option<f64>,
    pub distance: Option<f64>,
    pub ascent: Option<u16>,
    pub avg_speed: Option<f64>,
    pub max_speed: Option<f64>,
    pub avg_heart_rate: Option<u8>,
    pub max_heart_rate: Option<u8>,
    pub avg_cadence: Option<u8>,
    pub max_cadence: Option<u8>,
    pub avg_power: Option<u16>,
    pub max_power: Option<u16>,
    pub calories: Option<u16>,
}

#[derive(Debug, Clone)]
pub(crate) struct Activity {
    /// The start in Unix seconds, UTC.
    pub start_unix: i64,
    /// Local wall clock minus UTC, in seconds.
    pub utc_offset_secs: i64,
    /// The profile's Sport number.
    pub sport: u8,
    /// The profile's SubSport number.
    pub sub_sport: u8,
    pub samples: Vec<Sample>,
    pub totals: SessionTotals,
    /// The recording device as a `file_id` message holds it, the profile's
    /// manufacturer and product numbers. `None` writes no `file_id`.
    pub device: Option<(u16, u16)>,
}

impl Activity {
    /// The FIT file: an activity message, a session and the records.
    pub(crate) fn to_fit(&self) -> Vec<u8> {
        let mut data = Vec::new();
        self.write_file_id(&mut data);
        self.write_records(&mut data);
        self.write_session(&mut data);
        self.write_activity(&mut data);
        wrap(data)
    }

    fn write_file_id(&self, out: &mut Vec<u8>) {
        let Some((manufacturer, product)) = self.device else {
            return;
        };
        definition(
            out,
            3,
            0,
            &[(0, 1, BASE_ENUM), (1, 2, BASE_UINT16), (2, 2, BASE_UINT16)],
        );
        out.push(3);
        out.push(4);
        out.extend_from_slice(&manufacturer.to_le_bytes());
        out.extend_from_slice(&product.to_le_bytes());
    }

    fn fit_time(&self, offset: i64) -> u32 {
        (self.start_unix + offset - FIT_EPOCH_UNIX) as u32
    }

    fn write_records(&self, out: &mut Vec<u8>) {
        definition(
            out,
            0,
            20,
            &[
                (253, 4, BASE_UINT32),
                (0, 4, BASE_SINT32),
                (1, 4, BASE_SINT32),
                (2, 2, BASE_UINT16),
                (3, 1, BASE_UINT8),
                (4, 1, BASE_UINT8),
                (5, 4, BASE_UINT32),
                (6, 2, BASE_UINT16),
                (7, 2, BASE_UINT16),
            ],
        );
        for s in &self.samples {
            out.push(0);
            out.extend_from_slice(&self.fit_time(i64::from(s.at)).to_le_bytes());
            let (lat, lng) = match s.position {
                Some((lat, lng)) => (semicircles(lat), semicircles(lng)),
                None => (INVALID_SINT32, INVALID_SINT32),
            };
            out.extend_from_slice(&lat.to_le_bytes());
            out.extend_from_slice(&lng.to_le_bytes());
            // altitude is scaled by 5 with an offset of 500 m
            out.extend_from_slice(&scaled_u16(s.altitude.map(|a| (a + 500.0) * 5.0)).to_le_bytes());
            out.push(s.heart_rate.unwrap_or(INVALID_UINT8));
            out.push(s.cadence.unwrap_or(INVALID_UINT8));
            out.extend_from_slice(&scaled_u32(s.distance.map(|d| d * 100.0)).to_le_bytes());
            out.extend_from_slice(&scaled_u16(s.speed.map(|v| v * 1000.0)).to_le_bytes());
            out.extend_from_slice(&s.power.unwrap_or(INVALID_UINT16).to_le_bytes());
        }
    }

    fn write_session(&self, out: &mut Vec<u8>) {
        let t = &self.totals;
        let end = self.samples.last().map_or(0, |s| i64::from(s.at));
        definition(
            out,
            1,
            18,
            &[
                (253, 4, BASE_UINT32),
                (2, 4, BASE_UINT32),
                (5, 1, BASE_ENUM),
                (6, 1, BASE_ENUM),
                (7, 4, BASE_UINT32),
                (8, 4, BASE_UINT32),
                (9, 4, BASE_UINT32),
                (11, 2, BASE_UINT16),
                (14, 2, BASE_UINT16),
                (15, 2, BASE_UINT16),
                (16, 1, BASE_UINT8),
                (17, 1, BASE_UINT8),
                (18, 1, BASE_UINT8),
                (19, 1, BASE_UINT8),
                (20, 2, BASE_UINT16),
                (21, 2, BASE_UINT16),
                (22, 2, BASE_UINT16),
            ],
        );
        out.push(1);
        out.extend_from_slice(&self.fit_time(end).to_le_bytes());
        out.extend_from_slice(&self.fit_time(0).to_le_bytes());
        out.push(self.sport);
        out.push(self.sub_sport);
        out.extend_from_slice(&scaled_u32(t.elapsed_secs.map(|v| v * 1000.0)).to_le_bytes());
        out.extend_from_slice(&scaled_u32(t.timer_secs.map(|v| v * 1000.0)).to_le_bytes());
        out.extend_from_slice(&scaled_u32(t.distance.map(|v| v * 100.0)).to_le_bytes());
        out.extend_from_slice(&t.calories.unwrap_or(INVALID_UINT16).to_le_bytes());
        out.extend_from_slice(&scaled_u16(t.avg_speed.map(|v| v * 1000.0)).to_le_bytes());
        out.extend_from_slice(&scaled_u16(t.max_speed.map(|v| v * 1000.0)).to_le_bytes());
        out.push(t.avg_heart_rate.unwrap_or(INVALID_UINT8));
        out.push(t.max_heart_rate.unwrap_or(INVALID_UINT8));
        out.push(t.avg_cadence.unwrap_or(INVALID_UINT8));
        out.push(t.max_cadence.unwrap_or(INVALID_UINT8));
        out.extend_from_slice(&t.avg_power.unwrap_or(INVALID_UINT16).to_le_bytes());
        out.extend_from_slice(&t.max_power.unwrap_or(INVALID_UINT16).to_le_bytes());
        out.extend_from_slice(&t.ascent.unwrap_or(INVALID_UINT16).to_le_bytes());
    }

    fn write_activity(&self, out: &mut Vec<u8>) {
        definition(
            out,
            2,
            34,
            &[
                (253, 4, BASE_UINT32),
                (5, 4, BASE_UINT32),
                (1, 2, BASE_UINT16),
            ],
        );
        let end = self.samples.last().map_or(0, |s| i64::from(s.at));
        out.push(2);
        out.extend_from_slice(&self.fit_time(end).to_le_bytes());
        out.extend_from_slice(&self.fit_time(end + self.utc_offset_secs).to_le_bytes());
        out.extend_from_slice(&1u16.to_le_bytes());
    }
}

fn semicircles(degrees: f64) -> i32 {
    (degrees * (2_147_483_648.0 / 180.0)).round() as i32
}

fn scaled_u16(value: Option<f64>) -> u16 {
    value.map_or(INVALID_UINT16, |v| v.round().clamp(0.0, 65_534.0) as u16)
}

fn scaled_u32(value: Option<f64>) -> u32 {
    value.map_or(INVALID_UINT32, |v| {
        v.round().clamp(0.0, f64::from(u32::MAX - 1)) as u32
    })
}

fn definition(out: &mut Vec<u8>, local: u8, global: u16, fields: &[(u8, u8, u8)]) {
    out.push(0x40 | local);
    out.push(0);
    out.push(0);
    out.extend_from_slice(&global.to_le_bytes());
    out.push(fields.len() as u8);
    for (number, size, base) in fields {
        out.extend_from_slice(&[*number, *size, *base]);
    }
}

/// The FIT CRC-16 the SDK specifies.
fn crc(bytes: &[u8]) -> u16 {
    const TABLE: [u16; 16] = [
        0x0000, 0xCC01, 0xD801, 0x1400, 0xF001, 0x3C00, 0x2800, 0xE401, 0xA001, 0x6C00, 0x7800,
        0xB401, 0x5000, 0x9C01, 0x8801, 0x4400,
    ];
    bytes.iter().fold(0u16, |crc, byte| {
        let tmp = TABLE[(crc & 0xF) as usize];
        let crc = (crc >> 4) & 0x0FFF;
        let crc = crc ^ tmp ^ TABLE[(byte & 0xF) as usize];
        let tmp = TABLE[(crc & 0xF) as usize];
        let crc = (crc >> 4) & 0x0FFF;
        crc ^ tmp ^ TABLE[((byte >> 4) & 0xF) as usize]
    })
}

fn wrap(data: Vec<u8>) -> Vec<u8> {
    let mut file = vec![14, 0x20];
    file.extend_from_slice(&2132u16.to_le_bytes());
    file.extend_from_slice(&(data.len() as u32).to_le_bytes());
    file.extend_from_slice(b".FIT");
    let header_crc = crc(&file);
    file.extend_from_slice(&header_crc.to_le_bytes());
    file.extend(data);
    let file_crc = crc(&file);
    file.extend_from_slice(&file_crc.to_le_bytes());
    file
}

/// The profile's Sport number the tests use.
pub(crate) const SPORT_CYCLING: u8 = 2;
/// The profile's SubSport numbers the tests use.
pub(crate) const SUB_SPORT_GENERIC: u8 = 0;
pub(crate) const SUB_SPORT_INDOOR_CYCLING: u8 = 6;

/// A 30 s outdoor ride at 1 Hz with every sensor, starting at 2026-03-14
/// 07:00:00 UTC, which is 09:00:00 on the wall clock of a zone two hours ahead.
pub(crate) fn outdoor_ride() -> Activity {
    let samples = (0..30u32)
        .map(|i| Sample {
            at: i,
            position: Some((46.5 + f64::from(i) * 0.0001, 7.25 + f64::from(i) * 0.00005)),
            altitude: Some(500.0 + f64::from(i) * 0.5),
            heart_rate: Some(120 + i as u8),
            cadence: Some(80 + (i % 5) as u8),
            distance: Some(f64::from(i) * 6.0),
            speed: Some(6.0),
            power: Some(200 + i as u16),
        })
        .collect();
    Activity {
        start_unix: 1_773_471_600,
        utc_offset_secs: 7_200,
        sport: SPORT_CYCLING,
        sub_sport: SUB_SPORT_GENERIC,
        samples,
        device: None,
        totals: SessionTotals {
            elapsed_secs: Some(30.0),
            timer_secs: Some(28.0),
            distance: Some(174.0),
            ascent: Some(15),
            avg_speed: Some(6.2),
            max_speed: Some(6.5),
            avg_heart_rate: Some(135),
            max_heart_rate: Some(149),
            avg_cadence: Some(82),
            max_cadence: Some(84),
            avg_power: Some(214),
            max_power: Some(229),
            calories: Some(11),
        },
    }
}

/// The same ride on a trainer: no positions, no altitude.
pub(crate) fn indoor_ride() -> Activity {
    let mut ride = outdoor_ride();
    ride.sub_sport = SUB_SPORT_INDOOR_CYCLING;
    for sample in &mut ride.samples {
        sample.position = None;
        sample.altitude = None;
    }
    ride.totals.ascent = None;
    ride
}
