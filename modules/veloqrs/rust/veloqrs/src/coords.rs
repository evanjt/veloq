/// Delta + zigzag-varint encoding for GPS coordinate arrays.
///
/// Wire format:
///   - Header: point_count as varint
///   - First point: lat_scaled as varint i64, lng_scaled as varint i64
///   - Subsequent points: delta_lat as zigzag varint, delta_lng as zigzag varint
///   - Optional trailing elevation section, present only when at least one
///     point carries a finite elevation:
///       - `ELE_TAG` byte
///       - mode byte: bit 0 set means a presence bitmap follows, bit 1 set
///         means exact f64 payloads rather than quantised deltas
///       - presence bitmap of ceil(n/8) bytes, LSB first, when bit 0 is set
///       - per elevation-bearing point, in point order: a zigzag varint delta
///         of the 0.1 m quantised value, or 8 little-endian f64 bytes
///
/// Coordinates are scaled by 1e7 (0.011m precision) and stored as i64.
/// Consecutive deltas are small, so zigzag + varint encoding yields 1-3 bytes
/// per coordinate instead of 8 bytes for f64.
///
/// The elevation section sits past the point stream a reader without elevation
/// support stops at, so older readers see the coordinates and ignore the rest.
/// Quantised mode is used only when every value survives the 0.1 m grid
/// unchanged, so elevation always round trips exactly.

const SCALE: f64 = 1e7;
const ELE_SCALE: f64 = 10.0;
const ELE_TAG: u8 = 0xE1;
const ELE_MIXED: u8 = 0b01;
const ELE_EXACT: u8 = 0b10;

pub fn encode(points: &[crate::GpsPoint]) -> Vec<u8> {
    let mut buf = Vec::with_capacity(4 + points.len() * 4);
    write_varint(&mut buf, points.len() as u64);

    let mut prev_lat: i64 = 0;
    let mut prev_lng: i64 = 0;

    for p in points {
        let lat = (p.latitude * SCALE).round() as i64;
        let lng = (p.longitude * SCALE).round() as i64;

        write_zigzag(&mut buf, lat - prev_lat);
        write_zigzag(&mut buf, lng - prev_lng);

        prev_lat = lat;
        prev_lng = lng;
    }

    write_elevations(&mut buf, points);
    buf
}

/// A non-finite elevation is treated as absent, never as a value.
fn finite_elevation(p: &crate::GpsPoint) -> Option<f64> {
    p.elevation.filter(|e| e.is_finite())
}

fn write_elevations(buf: &mut Vec<u8>, points: &[crate::GpsPoint]) {
    let present = points
        .iter()
        .filter(|p| finite_elevation(p).is_some())
        .count();
    if present == 0 {
        return;
    }

    let exact = points
        .iter()
        .filter_map(finite_elevation)
        .any(|e| !on_quantised_grid(e));

    let mut mode = 0u8;
    if present < points.len() {
        mode |= ELE_MIXED;
    }
    if exact {
        mode |= ELE_EXACT;
    }

    buf.push(ELE_TAG);
    buf.push(mode);

    if mode & ELE_MIXED != 0 {
        let mut bitmap = vec![0u8; points.len().div_ceil(8)];
        for (i, p) in points.iter().enumerate() {
            if finite_elevation(p).is_some() {
                bitmap[i / 8] |= 1 << (i % 8);
            }
        }
        buf.extend_from_slice(&bitmap);
    }

    let mut prev: i64 = 0;
    for e in points.iter().filter_map(finite_elevation) {
        if exact {
            buf.extend_from_slice(&e.to_le_bytes());
        } else {
            let q = (e * ELE_SCALE).round() as i64;
            write_zigzag(buf, q - prev);
            prev = q;
        }
    }
}

fn on_quantised_grid(e: f64) -> bool {
    let q = (e * ELE_SCALE).round();
    q.abs() < i64::MAX as f64 && q / ELE_SCALE == e
}

pub fn decode(buf: &[u8]) -> Vec<crate::GpsPoint> {
    let mut pos = 0;
    let count = read_varint(buf, &mut pos) as usize;
    let mut points = Vec::with_capacity(count);

    let mut lat: i64 = 0;
    let mut lng: i64 = 0;

    for _ in 0..count {
        if pos >= buf.len() {
            break;
        }
        lat += read_zigzag(buf, &mut pos);
        lng += read_zigzag(buf, &mut pos);

        points.push(crate::GpsPoint {
            latitude: lat as f64 / SCALE,
            longitude: lng as f64 / SCALE,
            elevation: None,
        });
    }

    read_elevations(buf, &mut pos, &mut points);
    points
}

fn read_elevations(buf: &[u8], pos: &mut usize, points: &mut [crate::GpsPoint]) {
    if buf.get(*pos) != Some(&ELE_TAG) {
        return;
    }
    *pos += 1;
    let Some(&mode) = buf.get(*pos) else {
        return;
    };
    *pos += 1;

    let exact = mode & ELE_EXACT != 0;
    let bitmap = if mode & ELE_MIXED != 0 {
        let len = points.len().div_ceil(8);
        if buf.len() < *pos + len {
            return;
        }
        let slice = &buf[*pos..*pos + len];
        *pos += len;
        Some(slice)
    } else {
        None
    };

    let mut prev: i64 = 0;
    for (i, p) in points.iter_mut().enumerate() {
        if let Some(bits) = bitmap
            && bits[i / 8] & (1 << (i % 8)) == 0
        {
            continue;
        }
        if exact {
            if buf.len() < *pos + 8 {
                return;
            }
            let bytes: [u8; 8] = buf[*pos..*pos + 8].try_into().unwrap_or([0; 8]);
            *pos += 8;
            p.elevation = Some(f64::from_le_bytes(bytes));
        } else {
            if *pos >= buf.len() {
                return;
            }
            prev += read_zigzag(buf, pos);
            p.elevation = Some(prev as f64 / ELE_SCALE);
        }
    }
}

fn write_varint(buf: &mut Vec<u8>, mut v: u64) {
    loop {
        let byte = (v & 0x7F) as u8;
        v >>= 7;
        if v == 0 {
            buf.push(byte);
            break;
        }
        buf.push(byte | 0x80);
    }
}

fn read_varint(buf: &[u8], pos: &mut usize) -> u64 {
    let mut result: u64 = 0;
    let mut shift = 0;
    while *pos < buf.len() {
        let byte = buf[*pos];
        *pos += 1;
        result |= ((byte & 0x7F) as u64) << shift;
        if byte & 0x80 == 0 {
            break;
        }
        shift += 7;
    }
    result
}

fn write_zigzag(buf: &mut Vec<u8>, v: i64) {
    let encoded = ((v << 1) ^ (v >> 63)) as u64;
    write_varint(buf, encoded);
}

fn read_zigzag(buf: &[u8], pos: &mut usize) -> i64 {
    let v = read_varint(buf, pos);
    ((v >> 1) as i64) ^ -((v & 1) as i64)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn round_trip_empty() {
        let points: Vec<crate::GpsPoint> = vec![];
        let encoded = encode(&points);
        let decoded = decode(&encoded);
        assert_eq!(decoded.len(), 0);
    }

    #[test]
    fn round_trip_single_point() {
        let points = vec![crate::GpsPoint::new(51.5074, -0.1278)];
        let encoded = encode(&points);
        let decoded = decode(&encoded);
        assert_eq!(decoded.len(), 1);
        assert!((decoded[0].latitude - 51.5074).abs() < 1e-6);
        assert!((decoded[0].longitude - -0.1278).abs() < 1e-6);
    }

    #[test]
    fn round_trip_track() {
        let points: Vec<crate::GpsPoint> = (0..1000)
            .map(|i| crate::GpsPoint::new(46.5 + i as f64 * 0.0001, 6.6 + i as f64 * 0.00005))
            .collect();
        let encoded = encode(&points);
        let decoded = decode(&encoded);

        assert_eq!(decoded.len(), 1000);
        for (orig, dec) in points.iter().zip(decoded.iter()) {
            assert!((orig.latitude - dec.latitude).abs() < 1e-6);
            assert!((orig.longitude - dec.longitude).abs() < 1e-6);
        }

        // Verify compression: 1000 points at ~3 bytes each ≈ 6KB, vs 16KB for Vec<f64>
        assert!(
            encoded.len() < 8000,
            "encoded size {} should be < 8000",
            encoded.len()
        );
    }

    fn at(lat: f64, lng: f64, ele: Option<f64>) -> crate::GpsPoint {
        crate::GpsPoint {
            latitude: lat,
            longitude: lng,
            elevation: ele,
        }
    }

    /// The wire form as it stood before the elevation section existed.
    fn legacy_encode(coords: &[(f64, f64)]) -> Vec<u8> {
        let mut buf = Vec::new();
        write_varint(&mut buf, coords.len() as u64);
        let mut prev_lat = 0i64;
        let mut prev_lng = 0i64;
        for &(lat, lng) in coords {
            let la = (lat * SCALE).round() as i64;
            let ln = (lng * SCALE).round() as i64;
            write_zigzag(&mut buf, la - prev_lat);
            write_zigzag(&mut buf, ln - prev_lng);
            prev_lat = la;
            prev_lng = ln;
        }
        buf
    }

    #[test]
    fn round_trip_uniform_elevation() {
        let points: Vec<crate::GpsPoint> = (0..50)
            .map(|i| at(46.5 + i as f64 * 0.0001, 6.6, Some(400.0 + i as f64 * 0.1)))
            .collect();
        let decoded = decode(&encode(&points));

        assert_eq!(decoded.len(), points.len());
        for (orig, dec) in points.iter().zip(decoded.iter()) {
            assert_eq!(orig.elevation, dec.elevation);
        }
    }

    #[test]
    fn round_trip_mixed_elevation() {
        let points = vec![
            at(46.5, 6.6, Some(412.3)),
            at(46.5001, 6.6001, None),
            at(46.5002, 6.6002, Some(0.0)),
            at(46.5003, 6.6003, None),
            at(46.5004, 6.6004, Some(-8.5)),
        ];
        let decoded = decode(&encode(&points));

        let elevations: Vec<Option<f64>> = decoded.iter().map(|p| p.elevation).collect();
        assert_eq!(
            elevations,
            vec![Some(412.3), None, Some(0.0), None, Some(-8.5)]
        );
    }

    /// Sea level is a real elevation, not a stand-in for unknown.
    #[test]
    fn zero_and_absent_elevation_stay_distinct() {
        let decoded = decode(&encode(&[at(0.0, 0.0, Some(0.0)), at(0.0001, 0.0, None)]));
        assert_eq!(decoded[0].elevation, Some(0.0));
        assert_eq!(decoded[1].elevation, None);
    }

    #[test]
    fn round_trip_off_grid_elevation_is_exact() {
        let points = vec![
            at(46.5, 6.6, Some(412.34567)),
            at(46.5001, 6.6001, None),
            at(46.5002, 6.6002, Some(std::f64::consts::PI)),
        ];
        let decoded = decode(&encode(&points));

        assert_eq!(decoded[0].elevation, Some(412.34567));
        assert_eq!(decoded[1].elevation, None);
        assert_eq!(decoded[2].elevation, Some(std::f64::consts::PI));
    }

    #[test]
    fn non_finite_elevation_decodes_as_absent() {
        let decoded = decode(&encode(&[
            at(46.5, 6.6, Some(f64::NAN)),
            at(46.5001, 6.6001, Some(f64::INFINITY)),
        ]));
        assert_eq!(decoded[0].elevation, None);
        assert_eq!(decoded[1].elevation, None);
    }

    #[test]
    fn elevation_free_points_add_no_bytes() {
        let points: Vec<crate::GpsPoint> = (0..20)
            .map(|i| crate::GpsPoint::new(46.5 + i as f64 * 0.0001, 6.6))
            .collect();
        let coords: Vec<(f64, f64)> = points.iter().map(|p| (p.latitude, p.longitude)).collect();
        assert_eq!(encode(&points), legacy_encode(&coords));
    }

    /// A payload written before the elevation section existed: count then two
    /// zigzag varints per point, nothing after.
    #[test]
    fn legacy_payload_without_elevation_still_decodes() {
        let coords = [(46.5, 6.6), (46.5001, 6.6001), (46.5002, 6.6002)];
        let buf = legacy_encode(&coords);

        let decoded = decode(&buf);
        assert_eq!(decoded.len(), 3);
        for (dec, (lat, lng)) in decoded.iter().zip(coords) {
            assert!((dec.latitude - lat).abs() < 1e-6);
            assert!((dec.longitude - lng).abs() < 1e-6);
            assert_eq!(dec.elevation, None);
        }
    }

    /// Readers that stop after the point stream keep working, so the
    /// coordinates a legacy decoder sees must be byte-identical.
    #[test]
    fn elevation_section_is_appended_after_the_point_stream() {
        let flat = vec![at(46.5, 6.6, None), at(46.5001, 6.6001, None)];
        let hilly = vec![at(46.5, 6.6, Some(400.0)), at(46.5001, 6.6001, Some(401.0))];

        let flat_bytes = encode(&flat);
        let hilly_bytes = encode(&hilly);

        assert_eq!(hilly_bytes[..flat_bytes.len()], flat_bytes[..]);
        assert_eq!(hilly_bytes[flat_bytes.len()], ELE_TAG);
    }

    #[test]
    fn truncated_elevation_section_does_not_panic() {
        let points = vec![at(46.5, 6.6, Some(400.0)), at(46.5001, 6.6001, None)];
        let full = encode(&points);
        for cut in 0..full.len() {
            let decoded = decode(&full[..cut]);
            assert!(decoded.len() <= points.len());
        }
    }

    #[test]
    fn compression_ratio() {
        let points: Vec<crate::GpsPoint> = (0..100)
            .map(|i| crate::GpsPoint::new(46.5 + i as f64 * 0.0001, 6.6 + i as f64 * 0.00005))
            .collect();
        let encoded = encode(&points);
        let flat_f64_size = points.len() * 16; // 2 x f64 per point
        let ratio = flat_f64_size as f64 / encoded.len() as f64;
        assert!(ratio > 3.0, "compression ratio {} should be > 3x", ratio);
    }
}
