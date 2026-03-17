import type { ActivityType } from '@/types';
import type { RecordingStreams, RecordingLap } from '@/types';
import { debug } from '@/lib';

const log = debug.create('FitGenerator');

// FIT epoch: 1989-12-31T00:00:00Z
const FIT_EPOCH = Date.UTC(1989, 11, 31, 0, 0, 0) / 1000;

// Semicircle conversion: degrees * (2^31 / 180)
const SEMICIRCLE_FACTOR = 2147483648 / 180;

// FIT protocol constants
const FIT_HEADER_SIZE = 14;
const FIT_SIGNATURE = [0x2e, 0x46, 0x49, 0x54]; // ".FIT"
const PROTOCOL_VERSION = 0x20; // 2.0
const PROFILE_VERSION_MAJOR = 21;
const PROFILE_VERSION_MINOR = 60;

// FIT field types
const FIT_UINT8 = 0;
const FIT_SINT8 = 1;
const FIT_UINT16 = 132;
const FIT_SINT16 = 131;
const FIT_UINT32 = 134;
const FIT_SINT32 = 133;
const FIT_ENUM = 0;

// FIT global message numbers
const MESG_FILE_ID = 0;
const MESG_SESSION = 18;
const MESG_LAP = 19;
const MESG_RECORD = 20;
const MESG_ACTIVITY = 34;

// Sport types
const SPORT_MAP: Partial<Record<ActivityType, [number, number]>> = {
  Ride: [2, 0],
  VirtualRide: [2, 58],
  EBikeRide: [2, 28],
  MountainBikeRide: [2, 1],
  GravelRide: [2, 0],
  Run: [1, 0],
  VirtualRun: [1, 45],
  TrailRun: [1, 1],
  Treadmill: [1, 1],
  Walk: [11, 0],
  Hike: [17, 0],
  Swim: [5, 0],
  OpenWaterSwim: [5, 18],
  AlpineSki: [13, 0],
  NordicSki: [12, 0],
  Rowing: [15, 0],
  Kayaking: [41, 0],
  Yoga: [4, 15],
  WeightTraining: [4, 13],
  Workout: [4, 0],
  Surfing: [56, 0],
  Snowboard: [14, 0],
  Golf: [25, 0],
  Skateboard: [0, 0],
  Other: [0, 0],
};

function getSport(activityType: ActivityType): [number, number] {
  return SPORT_MAP[activityType] ?? [0, 0];
}

function dateToFitTimestamp(date: Date): number {
  return Math.floor(date.getTime() / 1000) - FIT_EPOCH;
}

function degreesToSemicircles(degrees: number): number {
  return Math.round(degrees * SEMICIRCLE_FACTOR);
}

// CRC-16 lookup table for FIT files
const CRC_TABLE = new Uint16Array(16);
(function initCrcTable() {
  for (let i = 0; i < 16; i++) {
    let crc = 0;
    for (let bit = 0; bit < 8; bit++) {
      if (((i >> bit) & 1) === 1) {
        crc ^= 0xa001 << (bit % 8);
      }
    }
    CRC_TABLE[i] = crc;
  }
})();

/**
 * Minimal FIT binary writer.
 * Builds FIT file byte-by-byte with definition and data messages.
 */
class FitWriter {
  private buffer: number[] = [];
  private dataSize = 0;

  writeUint8(value: number): void {
    this.buffer.push(value & 0xff);
    this.dataSize++;
  }

  writeSint8(value: number): void {
    this.writeUint8(value < 0 ? value + 256 : value);
  }

  writeUint16(value: number): void {
    this.writeUint8(value & 0xff);
    this.writeUint8((value >> 8) & 0xff);
  }

  writeSint16(value: number): void {
    this.writeUint16(value < 0 ? value + 65536 : value);
  }

  writeUint32(value: number): void {
    this.writeUint8(value & 0xff);
    this.writeUint8((value >> 8) & 0xff);
    this.writeUint8((value >> 16) & 0xff);
    this.writeUint8((value >> 24) & 0xff);
  }

  writeSint32(value: number): void {
    this.writeUint32(value < 0 ? value + 4294967296 : value);
  }

  writeHeader(): void {
    // Will be filled after data is written
    // header_size(1) + protocol_version(1) + profile_version(2) + data_size(4) + ".FIT"(4) + header_crc(2)
    for (let i = 0; i < FIT_HEADER_SIZE; i++) {
      this.buffer.push(0);
    }
    this.dataSize = 0; // Data size tracks only message bytes
  }

  /**
   * Write a definition message.
   * record_header(1) + reserved(1) + arch(1) + mesg_num(2) + num_fields(1) + fields(3 each)
   */
  writeDefinition(
    localMesgType: number,
    globalMesgNum: number,
    fields: { fieldNum: number; size: number; baseType: number }[]
  ): void {
    // Record header: bit 6 = 1 (definition), bits 0-3 = local message type
    this.writeUint8(0x40 | (localMesgType & 0x0f));
    this.writeUint8(0); // Reserved
    this.writeUint8(0); // Architecture: 0 = little-endian
    this.writeUint16(globalMesgNum);
    this.writeUint8(fields.length);
    for (const field of fields) {
      this.writeUint8(field.fieldNum);
      this.writeUint8(field.size);
      this.writeUint8(field.baseType);
    }
  }

  /**
   * Write a data message record header.
   */
  writeDataHeader(localMesgType: number): void {
    // Record header: bit 6 = 0 (data), bits 0-3 = local message type
    this.writeUint8(localMesgType & 0x0f);
  }

  computeCrc(data: number[]): number {
    let crc = 0;
    for (const byte of data) {
      crc = (crc >> 4) ^ CRC_TABLE[(crc ^ byte) & 0x0f];
      crc = (crc >> 4) ^ CRC_TABLE[(crc ^ (byte >> 4)) & 0x0f];
    }
    return crc;
  }

  toArrayBuffer(): ArrayBuffer {
    // Fill in the header
    const profileVersion = PROFILE_VERSION_MAJOR * 100 + PROFILE_VERSION_MINOR;

    this.buffer[0] = FIT_HEADER_SIZE;
    this.buffer[1] = PROTOCOL_VERSION;
    this.buffer[2] = profileVersion & 0xff;
    this.buffer[3] = (profileVersion >> 8) & 0xff;
    this.buffer[4] = this.dataSize & 0xff;
    this.buffer[5] = (this.dataSize >> 8) & 0xff;
    this.buffer[6] = (this.dataSize >> 16) & 0xff;
    this.buffer[7] = (this.dataSize >> 24) & 0xff;
    this.buffer[8] = FIT_SIGNATURE[0];
    this.buffer[9] = FIT_SIGNATURE[1];
    this.buffer[10] = FIT_SIGNATURE[2];
    this.buffer[11] = FIT_SIGNATURE[3];

    // Header CRC (first 12 bytes)
    const headerCrc = this.computeCrc(this.buffer.slice(0, 12));
    this.buffer[12] = headerCrc & 0xff;
    this.buffer[13] = (headerCrc >> 8) & 0xff;

    // File CRC (everything after header)
    const dataCrc = this.computeCrc(this.buffer.slice(FIT_HEADER_SIZE));
    this.buffer.push(dataCrc & 0xff);
    this.buffer.push((dataCrc >> 8) & 0xff);

    const result = new Uint8Array(this.buffer);
    return result.buffer;
  }
}

/**
 * Generate a FIT file from recording streams.
 *
 * Creates a valid FIT binary file with file_id, record, lap, session,
 * and activity messages.
 */
export async function generateFitFile(params: {
  activityType: ActivityType;
  startTime: Date;
  streams: RecordingStreams;
  laps: RecordingLap[];
  name?: string;
}): Promise<ArrayBuffer> {
  const { activityType, startTime, streams, laps } = params;
  const writer = new FitWriter();
  const [sport, subSport] = getSport(activityType);
  const fitStartTime = dateToFitTimestamp(startTime);

  writer.writeHeader();

  // ---- file_id message (local type 0) ----
  writer.writeDefinition(0, MESG_FILE_ID, [
    { fieldNum: 0, size: 1, baseType: FIT_ENUM }, // type
    { fieldNum: 1, size: 2, baseType: FIT_UINT16 }, // manufacturer
    { fieldNum: 2, size: 2, baseType: FIT_UINT16 }, // product
    { fieldNum: 4, size: 4, baseType: FIT_UINT32 }, // time_created
  ]);
  writer.writeDataHeader(0);
  writer.writeUint8(4); // type = activity
  writer.writeUint16(255); // manufacturer = development
  writer.writeUint16(0); // product
  writer.writeUint32(fitStartTime);

  // ---- record definition (local type 1) ----
  const recordFields: { fieldNum: number; size: number; baseType: number }[] = [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 0, size: 4, baseType: FIT_SINT32 }, // position_lat
    { fieldNum: 1, size: 4, baseType: FIT_SINT32 }, // position_long
    { fieldNum: 2, size: 2, baseType: FIT_UINT16 }, // altitude (offset 500, scale 5)
    { fieldNum: 3, size: 1, baseType: FIT_UINT8 }, // heart_rate
    { fieldNum: 4, size: 1, baseType: FIT_UINT8 }, // cadence
    { fieldNum: 5, size: 4, baseType: FIT_UINT32 }, // distance (scale 100)
    { fieldNum: 6, size: 2, baseType: FIT_UINT16 }, // speed (scale 1000)
    { fieldNum: 7, size: 2, baseType: FIT_UINT16 }, // power
  ];
  writer.writeDefinition(1, MESG_RECORD, recordFields);

  // ---- record data messages ----
  const numPoints = streams.time.length;
  let maxSpeed = 0;
  let totalHr = 0;
  let hrCount = 0;
  let maxHr = 0;
  let totalPower = 0;
  let powerCount = 0;
  let maxPower = 0;
  let totalCadence = 0;
  let cadenceCount = 0;
  let maxCadence = 0;
  let totalDistance = 0;

  for (let i = 0; i < numPoints; i++) {
    writer.writeDataHeader(1);

    const timestamp = fitStartTime + streams.time[i];
    writer.writeUint32(timestamp);

    // Position
    const latlng = streams.latlng[i];
    if (latlng && latlng[0] !== 0 && latlng[1] !== 0) {
      writer.writeSint32(degreesToSemicircles(latlng[0]));
      writer.writeSint32(degreesToSemicircles(latlng[1]));
    } else {
      writer.writeSint32(0x7fffffff); // invalid
      writer.writeSint32(0x7fffffff); // invalid
    }

    // Altitude: offset binary, scale 5, offset 500
    const alt = streams.altitude[i] ?? 0;
    const fitAlt = Math.round((alt + 500) * 5);
    writer.writeUint16(Math.max(0, Math.min(65535, fitAlt)));

    // Heart rate
    const hr = streams.heartrate[i] ?? 0;
    writer.writeUint8(Math.min(255, Math.round(hr)));
    if (hr > 0) {
      totalHr += hr;
      hrCount++;
      if (hr > maxHr) maxHr = hr;
    }

    // Cadence
    const cad = streams.cadence[i] ?? 0;
    writer.writeUint8(Math.min(255, Math.round(cad)));
    if (cad > 0) {
      totalCadence += cad;
      cadenceCount++;
      if (cad > maxCadence) maxCadence = cad;
    }

    // Distance (cumulative, scale 100 = centimeters)
    const dist = streams.distance[i] ?? 0;
    writer.writeUint32(Math.round(dist * 100));
    totalDistance = dist;

    // Speed (scale 1000 = mm/s)
    const spd = streams.speed[i] ?? 0;
    writer.writeUint16(Math.min(65535, Math.round(spd * 1000)));
    if (spd > maxSpeed) maxSpeed = spd;

    // Power
    const pwr = streams.power[i] ?? 0;
    writer.writeUint16(Math.min(65535, Math.round(pwr)));
    if (pwr > 0) {
      totalPower += pwr;
      powerCount++;
      if (pwr > maxPower) maxPower = pwr;
    }
  }

  // ---- lap messages (local type 2) ----
  writer.writeDefinition(2, MESG_LAP, [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 2, size: 4, baseType: FIT_UINT32 }, // start_time
    { fieldNum: 7, size: 4, baseType: FIT_UINT32 }, // total_elapsed_time (scale 1000)
    { fieldNum: 9, size: 4, baseType: FIT_UINT32 }, // total_distance (scale 100)
    { fieldNum: 13, size: 2, baseType: FIT_UINT16 }, // avg_speed (scale 1000)
    { fieldNum: 15, size: 1, baseType: FIT_UINT8 }, // avg_heart_rate
    { fieldNum: 19, size: 2, baseType: FIT_UINT16 }, // avg_power
    { fieldNum: 17, size: 1, baseType: FIT_UINT8 }, // avg_cadence
  ]);

  for (const lap of laps) {
    writer.writeDataHeader(2);
    const lapEndTimestamp = fitStartTime + lap.endTime;
    writer.writeUint32(lapEndTimestamp);
    writer.writeUint32(fitStartTime + lap.startTime);
    writer.writeUint32(Math.round((lap.endTime - lap.startTime) * 1000));
    writer.writeUint32(Math.round(lap.distance * 100));
    writer.writeUint16(Math.min(65535, Math.round(lap.avgSpeed * 1000)));
    writer.writeUint8(lap.avgHeartrate ? Math.min(255, Math.round(lap.avgHeartrate)) : 0xff);
    writer.writeUint16(lap.avgPower ? Math.min(65535, Math.round(lap.avgPower)) : 0xffff);
    writer.writeUint8(lap.avgCadence ? Math.min(255, Math.round(lap.avgCadence)) : 0xff);
  }

  // ---- session message (local type 3) ----
  const elapsedTime = numPoints > 0 ? streams.time[numPoints - 1] : 0;
  const avgSpeed = elapsedTime > 0 ? totalDistance / elapsedTime : 0;
  const avgHr = hrCount > 0 ? totalHr / hrCount : 0;
  const avgPower = powerCount > 0 ? totalPower / powerCount : 0;
  const avgCadence = cadenceCount > 0 ? totalCadence / cadenceCount : 0;

  writer.writeDefinition(3, MESG_SESSION, [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 2, size: 4, baseType: FIT_UINT32 }, // start_time
    { fieldNum: 7, size: 4, baseType: FIT_UINT32 }, // total_elapsed_time (scale 1000)
    { fieldNum: 8, size: 4, baseType: FIT_UINT32 }, // total_timer_time (scale 1000)
    { fieldNum: 9, size: 4, baseType: FIT_UINT32 }, // total_distance (scale 100)
    { fieldNum: 5, size: 1, baseType: FIT_ENUM }, // sport
    { fieldNum: 6, size: 1, baseType: FIT_ENUM }, // sub_sport
    { fieldNum: 14, size: 2, baseType: FIT_UINT16 }, // avg_speed (scale 1000)
    { fieldNum: 15, size: 2, baseType: FIT_UINT16 }, // max_speed (scale 1000)
    { fieldNum: 16, size: 1, baseType: FIT_UINT8 }, // avg_heart_rate
    { fieldNum: 17, size: 1, baseType: FIT_UINT8 }, // max_heart_rate
    { fieldNum: 18, size: 1, baseType: FIT_UINT8 }, // avg_cadence
    { fieldNum: 19, size: 1, baseType: FIT_UINT8 }, // max_cadence
    { fieldNum: 20, size: 2, baseType: FIT_UINT16 }, // avg_power
    { fieldNum: 21, size: 2, baseType: FIT_UINT16 }, // max_power
  ]);

  writer.writeDataHeader(3);
  const sessionEndTimestamp = fitStartTime + elapsedTime;
  writer.writeUint32(sessionEndTimestamp);
  writer.writeUint32(fitStartTime);
  writer.writeUint32(Math.round(elapsedTime * 1000));
  writer.writeUint32(Math.round(elapsedTime * 1000)); // timer_time = elapsed for now
  writer.writeUint32(Math.round(totalDistance * 100));
  writer.writeUint8(sport);
  writer.writeUint8(subSport);
  writer.writeUint16(Math.min(65535, Math.round(avgSpeed * 1000)));
  writer.writeUint16(Math.min(65535, Math.round(maxSpeed * 1000)));
  writer.writeUint8(avgHr > 0 ? Math.min(255, Math.round(avgHr)) : 0xff);
  writer.writeUint8(maxHr > 0 ? Math.min(255, maxHr) : 0xff);
  writer.writeUint8(avgCadence > 0 ? Math.min(255, Math.round(avgCadence)) : 0xff);
  writer.writeUint8(maxCadence > 0 ? Math.min(255, maxCadence) : 0xff);
  writer.writeUint16(avgPower > 0 ? Math.min(65535, Math.round(avgPower)) : 0xffff);
  writer.writeUint16(maxPower > 0 ? Math.min(65535, maxPower) : 0xffff);

  // ---- activity message (local type 4) ----
  writer.writeDefinition(4, MESG_ACTIVITY, [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 0, size: 4, baseType: FIT_UINT32 }, // total_timer_time (scale 1000)
    { fieldNum: 1, size: 2, baseType: FIT_UINT16 }, // num_sessions
    { fieldNum: 2, size: 1, baseType: FIT_ENUM }, // type
  ]);
  writer.writeDataHeader(4);
  writer.writeUint32(sessionEndTimestamp);
  writer.writeUint32(Math.round(elapsedTime * 1000));
  writer.writeUint16(1); // num_sessions
  writer.writeUint8(0); // type = manual

  const result = writer.toArrayBuffer();
  log.log(`Generated FIT file: ${result.byteLength} bytes, ${numPoints} records`);
  return result;
}
