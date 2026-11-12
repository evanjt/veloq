//! The binary layer of a FIT writer: base types, invalid values, definition
//! messages, the CRC-16 and the file header, as the FIT SDK specifies them.

/// Seconds from the Unix epoch to the FIT epoch, 1989-12-31T00:00:00Z.
pub(crate) const FIT_EPOCH_UNIX: i64 = 631_065_600;

pub(crate) const BASE_ENUM: u8 = 0x00;
pub(crate) const BASE_UINT8: u8 = 0x02;
pub(crate) const BASE_STRING: u8 = 0x07;
#[cfg(test)]
pub(crate) const BASE_SINT32: u8 = 0x85;
pub(crate) const BASE_UINT16: u8 = 0x84;
pub(crate) const BASE_UINT32: u8 = 0x86;

pub(crate) const INVALID_UINT8: u8 = 0xFF;
pub(crate) const INVALID_UINT16: u16 = 0xFFFF;
pub(crate) const INVALID_UINT32: u32 = 0xFFFF_FFFF;
#[cfg(test)]
pub(crate) const INVALID_SINT32: i32 = 0x7FFF_FFFF;

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
