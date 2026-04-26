/// Delta + zigzag-varint encoding for GPS coordinate arrays.
///
/// Wire format:
///   - Header: point_count as varint
///   - First point: lat_scaled as varint i64, lng_scaled as varint i64
///   - Subsequent points: delta_lat as zigzag varint, delta_lng as zigzag varint
///
/// Coordinates are scaled by 1e7 (0.011m precision) and stored as i64.
/// Consecutive deltas are small, so zigzag + varint encoding yields 1-3 bytes
/// per coordinate instead of 8 bytes for f64.

const SCALE: f64 = 1e7;

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

    buf
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

    points
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
        assert!(encoded.len() < 8000, "encoded size {} should be < 8000", encoded.len());
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
