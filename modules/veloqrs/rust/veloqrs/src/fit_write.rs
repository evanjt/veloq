//! The binary layer of a FIT writer: base types, invalid values, definition
//! messages, the CRC-16 and the file header, as the FIT SDK specifies them.

/// Seconds from the Unix epoch to the FIT epoch, 1989-12-31T00:00:00Z.
pub(crate) const FIT_EPOCH_UNIX: i64 = 631_065_600;

pub(crate) const BASE_ENUM: u8 = 0x00;
pub(crate) const BASE_UINT8: u8 = 0x02;
pub(crate) const BASE_STRING: u8 = 0x07;
pub(crate) const BASE_SINT32: u8 = 0x85;
pub(crate) const BASE_UINT16: u8 = 0x84;
pub(crate) const BASE_UINT32: u8 = 0x86;
#[cfg(test)]
pub(crate) const BASE_UINT32Z: u8 = 0x8C;

pub(crate) const INVALID_UINT8: u8 = 0xFF;
pub(crate) const INVALID_UINT16: u16 = 0xFFFF;
pub(crate) const INVALID_UINT32: u32 = 0xFFFF_FFFF;
pub(crate) const INVALID_SINT32: i32 = 0x7FFF_FFFF;

/// The profile's development manufacturer, for software that is not a device
/// maker's, and the product number this app writes under it.
pub(crate) const MANUFACTURER_DEVELOPMENT: u16 = 255;
pub(crate) const PRODUCT_ID: u16 = 1;
pub(crate) const SOFTWARE_VERSION: u16 = 4;
pub(crate) const APP_NAME: &str = "Veloq";

pub(crate) const MESG_FILE_ID: u16 = 0;
pub(crate) const MESG_SESSION: u16 = 18;
pub(crate) const MESG_LAP: u16 = 19;
pub(crate) const MESG_RECORD: u16 = 20;
pub(crate) const MESG_EVENT: u16 = 21;
pub(crate) const MESG_DEVICE_INFO: u16 = 23;
pub(crate) const MESG_ACTIVITY: u16 = 34;

/// A definition message for local message type `local`, little endian, with
/// `(field number, size in bytes, base type)` per field.
pub(crate) fn definition(out: &mut Vec<u8>, local: u8, global: u16, fields: &[(u8, u8, u8)]) {
    out.push(0x40 | local);
    out.push(0);
    out.push(0);
    out.extend_from_slice(&global.to_le_bytes());
    out.push(fields.len() as u8);
    for (number, size, base) in fields {
        out.extend_from_slice(&[*number, *size, *base]);
    }
}

/// The `file_id` and `device_info` messages of an activity file, on local
/// message types 0 and 1: the file's type, the app that made it and when.
pub(crate) fn activity_identity(out: &mut Vec<u8>, start: u32) {
    let name_len = (APP_NAME.len() + 1) as u8;
    definition(
        out,
        0,
        MESG_FILE_ID,
        &[
            (0, 1, BASE_ENUM),
            (1, 2, BASE_UINT16),
            (2, 2, BASE_UINT16),
            (3, 4, BASE_UINT32),
            (4, 4, BASE_UINT32),
            (8, name_len, BASE_STRING),
        ],
    );
    out.push(0);
    out.push(4); // type: activity
    out.extend_from_slice(&MANUFACTURER_DEVELOPMENT.to_le_bytes());
    out.extend_from_slice(&PRODUCT_ID.to_le_bytes());
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(APP_NAME.as_bytes());
    out.push(0);

    definition(
        out,
        1,
        MESG_DEVICE_INFO,
        &[
            (253, 4, BASE_UINT32),
            (2, 2, BASE_UINT16),
            (3, 2, BASE_UINT16),
            (5, 2, BASE_UINT16),
            (0, 1, BASE_UINT8),
            (27, name_len, BASE_STRING),
        ],
    );
    out.push(1);
    out.extend_from_slice(&start.to_le_bytes());
    out.extend_from_slice(&MANUFACTURER_DEVELOPMENT.to_le_bytes());
    out.extend_from_slice(&PRODUCT_ID.to_le_bytes());
    out.extend_from_slice(&SOFTWARE_VERSION.to_le_bytes());
    out.push(0); // device_index: the creator
    out.extend_from_slice(APP_NAME.as_bytes());
    out.push(0);
}

/// A value rounded into a field's range, or the invalid value when it is not
/// a number. The top of the range is left to the invalid value.
pub(crate) fn scaled_u32(value: f64) -> u32 {
    if value.is_finite() {
        value.round().clamp(0.0, f64::from(u32::MAX - 1)) as u32
    } else {
        INVALID_UINT32
    }
}

/// Degrees as the profile's semicircles.
pub(crate) fn semicircles(degrees: f64) -> i32 {
    let value = (degrees * (2_147_483_648.0 / 180.0)).round();
    if value.is_finite() {
        value.clamp(f64::from(i32::MIN), f64::from(INVALID_SINT32 - 1)) as i32
    } else {
        INVALID_SINT32
    }
}

/// The profile's altitude: scaled by 5, offset by 500 m.
pub(crate) fn altitude_field(elevation: Option<f64>) -> u16 {
    match elevation {
        Some(m) if m.is_finite() => ((m + 500.0) * 5.0).round().clamp(0.0, 65_534.0) as u16,
        _ => INVALID_UINT16,
    }
}

/// The FIT CRC-16 the SDK specifies.
pub(crate) fn crc(bytes: &[u8]) -> u16 {
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

/// The 14-byte header, the data and the closing CRC.
pub(crate) fn wrap(data: Vec<u8>) -> Vec<u8> {
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
