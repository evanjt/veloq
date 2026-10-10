import { summariseLap } from './savedLaps';
import { elevationOver } from './elevationChange';
import type { ActivityType, RecordingStreams, RecordingLap } from '@/types';
import { debug } from '@/shared/debug/debug';

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
const PROFILE_VERSION_MINOR = 133;

// FIT field base types
const FIT_ENUM = 0;
const FIT_UINT8 = 0;
const FIT_SINT32 = 133;
const FIT_UINT16 = 132;
const FIT_UINT32 = 134;
const FIT_STRING = 7;

// FIT global message numbers
const MESG_FILE_ID = 0;
const MESG_DEVICE_INFO = 23;
const MESG_EVENT = 21;
const MESG_SESSION = 18;
const MESG_LAP = 19;
const MESG_RECORD = 20;
const MESG_ACTIVITY = 34;

// Veloq identification
// manufacturer=255 (development) is fine for non-Garmin apps.
// The product_name field is what platforms display as "Recorded with X".
const MANUFACTURER_DEVELOPMENT = 255;
const PRODUCT_ID = 1; // App-specific, arbitrary for development manufacturer
const APP_NAME = 'Veloq';
const APP_VERSION_MAJOR = 0;
const APP_VERSION_MINOR = 4;
const SOFTWARE_VERSION = APP_VERSION_MAJOR * 100 + APP_VERSION_MINOR; // 0.4 → 4

// Sport types: [sport, sub_sport]
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

// CRC-16 lookup table from FIT SDK (hardcoded, nibble-indexed)
// Reference: Garmin FIT SDK FitCRC.c
const CRC_TABLE = new Uint16Array([
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
]);
const CRC_BYTE_TABLE = new Uint16Array(256);
for (let value = 0; value < CRC_BYTE_TABLE.length; value++) {
  let crc = CRC_TABLE[value & 0x0f] as number;
  crc = (crc >> 4) ^ (CRC_TABLE[(crc ^ (value >> 4)) & 0x0f] as number);
  CRC_BYTE_TABLE[value] = crc;
}

const FIXED_MESSAGE_CAPACITY = 1024;
const RECORD_MESSAGE_BYTES = 33;
const LAP_MESSAGE_BYTES = 27;

/**
 * Minimal FIT binary writer.
 * Builds FIT definition and data messages in a sized buffer.
 */
class FitWriter {
  private bytes: Uint8Array;
  private length = 0;

  constructor(recordCount: number, lapCount: number) {
    this.bytes = new Uint8Array(
      FIXED_MESSAGE_CAPACITY +
        recordCount * RECORD_MESSAGE_BYTES +
        (lapCount + 1) * LAP_MESSAGE_BYTES
    );
  }

  writeUint8(value: number): void {
    this.bytes[this.length] = value & 0xff;
    this.length++;
  }

  writeUint16(value: number): void {
    const offset = this.length;
    this.bytes[offset] = value & 0xff;
    this.bytes[offset + 1] = (value >> 8) & 0xff;
    this.length = offset + 2;
  }

  writeUint32(value: number): void {
    const offset = this.length;
    this.bytes[offset] = value & 0xff;
    this.bytes[offset + 1] = (value >> 8) & 0xff;
    this.bytes[offset + 2] = (value >> 16) & 0xff;
    this.bytes[offset + 3] = (value >> 24) & 0xff;
    this.length = offset + 4;
  }

  writeSint32(value: number): void {
    this.writeUint32(value);
  }

  /** Write a fixed-length string (null-padded to size) */
  writeString(value: string, size: number): void {
    for (let i = 0; i < size; i++) {
      this.bytes[this.length + i] = i < value.length ? value.charCodeAt(i) & 0xff : 0;
    }
    this.length += size;
  }

  writeHeader(): void {
    this.length = FIT_HEADER_SIZE;
  }

  writeDefinition(
    localMesgType: number,
    globalMesgNum: number,
    fields: { fieldNum: number; size: number; baseType: number }[]
  ): void {
    this.writeUint8(0x40 | (localMesgType & 0x0f));
    this.writeUint8(0); // Reserved
    this.writeUint8(0); // Architecture: little-endian
    this.writeUint16(globalMesgNum);
    this.writeUint8(fields.length);
    for (const field of fields) {
      this.writeUint8(field.fieldNum);
      this.writeUint8(field.size);
      this.writeUint8(field.baseType);
    }
  }

  writeDataHeader(localMesgType: number): void {
    this.writeUint8(localMesgType & 0x0f);
  }

  computeCrc(from: number, to: number): number {
    let crc = 0;
    for (let i = from; i < to; i++) {
      const byte = this.bytes[i] as number;
      crc = (crc >> 8) ^ (CRC_BYTE_TABLE[(crc ^ byte) & 0xff] as number);
    }
    return crc;
  }

  toArrayBuffer(): ArrayBuffer {
    if (this.length + 2 > this.bytes.length) {
      throw new RangeError('FIT buffer capacity exceeded');
    }
    const profileVersion = PROFILE_VERSION_MAJOR * 100 + PROFILE_VERSION_MINOR;
    const dataSize = this.length - FIT_HEADER_SIZE;

    this.bytes[0] = FIT_HEADER_SIZE;
    this.bytes[1] = PROTOCOL_VERSION;
    this.bytes[2] = profileVersion & 0xff;
    this.bytes[3] = (profileVersion >> 8) & 0xff;
    this.bytes[4] = dataSize & 0xff;
    this.bytes[5] = (dataSize >> 8) & 0xff;
    this.bytes[6] = (dataSize >> 16) & 0xff;
    this.bytes[7] = (dataSize >> 24) & 0xff;
    this.bytes[8] = FIT_SIGNATURE[0];
    this.bytes[9] = FIT_SIGNATURE[1];
    this.bytes[10] = FIT_SIGNATURE[2];
    this.bytes[11] = FIT_SIGNATURE[3];

    const headerCrc = this.computeCrc(0, 12);
    this.bytes[12] = headerCrc & 0xff;
    this.bytes[13] = (headerCrc >> 8) & 0xff;

    const dataCrc = this.computeCrc(FIT_HEADER_SIZE, this.length);
    this.writeUint16(dataCrc);

    return this.bytes.slice(0, this.length).buffer;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Generate a FIT file from recording streams.
 *
 * Produces a spec-compliant FIT binary with:
 * - file_id with product_name "Veloq"
 * - device_info identifying the recording app + software version
 * - event start/stop markers
 * - GPS records with enhanced altitude/speed, plus GPS accuracy
 * - lap, session, and activity summary messages
 * - total ascent/descent from the altitude stream by the engine's rule
 */
export async function generateFitFile(params: {
  activityType: ActivityType;
  startTime: Date;
  streams: RecordingStreams;
  laps: RecordingLap[];
  name?: string;
  /** Total paused seconds; subtracted from total_timer_time (active time per spec). */
  pausedTimeSeconds?: number;
}): Promise<ArrayBuffer> {
  const { activityType, startTime, streams, laps, pausedTimeSeconds = 0 } = params;
  const writer = new FitWriter(streams.time.length, laps.length);
  const [sport, subSport] = getSport(activityType);
  const fitStartTime = dateToFitTimestamp(startTime);
  const productNameLen = APP_NAME.length + 1; // null-terminated

  writer.writeHeader();

  // ── file_id (local 0) ──────────────────────────────────────────────────────
  writer.writeDefinition(0, MESG_FILE_ID, [
    { fieldNum: 0, size: 1, baseType: FIT_ENUM }, // type
    { fieldNum: 1, size: 2, baseType: FIT_UINT16 }, // manufacturer
    { fieldNum: 2, size: 2, baseType: FIT_UINT16 }, // product
    { fieldNum: 3, size: 4, baseType: FIT_UINT32 }, // serial_number
    { fieldNum: 4, size: 4, baseType: FIT_UINT32 }, // time_created
    { fieldNum: 8, size: productNameLen, baseType: FIT_STRING }, // product_name
  ]);
  writer.writeDataHeader(0);
  writer.writeUint8(4); // type = activity
  writer.writeUint16(MANUFACTURER_DEVELOPMENT);
  writer.writeUint16(PRODUCT_ID);
  writer.writeUint32(fitStartTime); // serial = timestamp (unique enough)
  writer.writeUint32(fitStartTime);
  writer.writeString(APP_NAME, productNameLen);

  // ── device_info (local 5) ──────────────────────────────────────────────────
  writer.writeDefinition(5, MESG_DEVICE_INFO, [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 2, size: 2, baseType: FIT_UINT16 }, // manufacturer
    { fieldNum: 3, size: 2, baseType: FIT_UINT16 }, // product
    { fieldNum: 4, size: 2, baseType: FIT_UINT16 }, // software_version
    { fieldNum: 0, size: 1, baseType: FIT_UINT8 }, // device_index (0 = creator)
    { fieldNum: 27, size: productNameLen, baseType: FIT_STRING }, // product_name
  ]);
  writer.writeDataHeader(5);
  writer.writeUint32(fitStartTime);
  writer.writeUint16(MANUFACTURER_DEVELOPMENT);
  writer.writeUint16(PRODUCT_ID);
  writer.writeUint16(SOFTWARE_VERSION);
  writer.writeUint8(0); // device_index = 0 (creator device)
  writer.writeString(APP_NAME, productNameLen);

  // ── event: timer start (local 6) ──────────────────────────────────────────
  writer.writeDefinition(6, MESG_EVENT, [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 0, size: 1, baseType: FIT_ENUM }, // event
    { fieldNum: 1, size: 1, baseType: FIT_ENUM }, // event_type
  ]);
  writer.writeDataHeader(6);
  writer.writeUint32(fitStartTime);
  writer.writeUint8(0); // event = timer
  writer.writeUint8(0); // event_type = start

  // ── record definition (local 1) ───────────────────────────────────────────
  writer.writeDefinition(1, MESG_RECORD, [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 0, size: 4, baseType: FIT_SINT32 }, // position_lat
    { fieldNum: 1, size: 4, baseType: FIT_SINT32 }, // position_long
    { fieldNum: 2, size: 2, baseType: FIT_UINT16 }, // altitude (offset 500, scale 5)
    { fieldNum: 78, size: 4, baseType: FIT_UINT32 }, // enhanced_altitude (offset 500, scale 5)
    { fieldNum: 3, size: 1, baseType: FIT_UINT8 }, // heart_rate
    { fieldNum: 4, size: 1, baseType: FIT_UINT8 }, // cadence
    { fieldNum: 5, size: 4, baseType: FIT_UINT32 }, // distance (scale 100)
    { fieldNum: 6, size: 2, baseType: FIT_UINT16 }, // speed (scale 1000)
    { fieldNum: 73, size: 4, baseType: FIT_UINT32 }, // enhanced_speed (scale 1000)
    { fieldNum: 7, size: 2, baseType: FIT_UINT16 }, // power
  ]);

  // ── record data ────────────────────────────────────────────────────────────
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

    // Position (semicircles)
    const latlng = streams.latlng[i];
    if (latlng && latlng[0] !== 0 && latlng[1] !== 0) {
      writer.writeSint32(degreesToSemicircles(latlng[0]));
      writer.writeSint32(degreesToSemicircles(latlng[1]));
    } else {
      writer.writeSint32(0x7fffffff); // invalid
      writer.writeSint32(0x7fffffff); // invalid
    }

    // Altitude: offset binary, scale 5, offset 500. Missing readings use
    // the field's invalid sentinel; sea level is a valid measurement.
    const alt = streams.altitude?.[i];
    if (alt != null && Number.isFinite(alt)) {
      const fitAlt = Math.round((alt + 500) * 5);
      writer.writeUint16(Math.max(0, Math.min(65534, fitAlt)));
      writer.writeUint32(Math.max(0, Math.min(0xfffffffe, fitAlt)));
    } else {
      writer.writeUint16(0xffff);
      writer.writeUint32(0xffffffff);
    }

    // Heart rate
    const hr = streams.heartrate?.[i] ?? 0;
    writer.writeUint8(hr > 0 ? Math.min(255, Math.round(hr)) : 0xff);
    if (Number.isFinite(hr) && hr > 0) {
      totalHr += hr;
      hrCount++;
      if (hr > maxHr) maxHr = hr;
    }

    // Cadence
    const cad = streams.cadence?.[i] ?? 0;
    writer.writeUint8(cad > 0 ? Math.min(255, Math.round(cad)) : 0xff);
    if (Number.isFinite(cad) && cad > 0) {
      totalCadence += cad;
      cadenceCount++;
      if (cad > maxCadence) maxCadence = cad;
    }

    // Distance (cumulative, scale 100 = centimeters)
    const dist = streams.distance?.[i] ?? 0;
    writer.writeUint32(Math.round(dist * 100));
    totalDistance = dist;

    // Speed (scale 1000 = mm/s)
    // A negative or non-finite speed is no reading and uses the invalid
    // sentinels; the upper clamps stop short of them.
    const spd = streams.speed?.[i] ?? 0;
    if (Number.isFinite(spd) && spd >= 0) {
      const fitSpd = Math.round(spd * 1000);
      writer.writeUint16(Math.min(65534, fitSpd)); // legacy speed (16-bit)
      writer.writeUint32(Math.min(0xfffffffe, fitSpd)); // enhanced_speed (32-bit)
      if (spd > maxSpeed) maxSpeed = spd;
    } else {
      writer.writeUint16(0xffff);
      writer.writeUint32(0xffffffff);
    }

    // Power
    const pwr = streams.power?.[i] ?? 0;
    writer.writeUint16(pwr > 0 ? Math.min(65535, Math.round(pwr)) : 0xffff);
    if (Number.isFinite(pwr) && pwr > 0) {
      totalPower += pwr;
      powerCount++;
      if (pwr > maxPower) maxPower = pwr;
    }
  }

  // ── event: timer stop (reuse local 6) ──────────────────────────────────────
  const elapsedTime = numPoints > 0 ? streams.time[numPoints - 1] : 0;
  // total_timer_time is active (moving) time per the FIT spec; total_elapsed_time is wall time
  const timerTime = Math.max(0, elapsedTime - Math.max(0, pausedTimeSeconds));
  const sessionEndTimestamp = fitStartTime + elapsedTime;

  writer.writeDataHeader(6);
  writer.writeUint32(sessionEndTimestamp);
  writer.writeUint8(0); // event = timer
  writer.writeUint8(4); // event_type = stop_all

  // ── lap messages (local 2) ─────────────────────────────────────────────────
  writer.writeDefinition(2, MESG_LAP, [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 2, size: 4, baseType: FIT_UINT32 }, // start_time
    { fieldNum: 7, size: 4, baseType: FIT_UINT32 }, // total_elapsed_time (scale 1000)
    { fieldNum: 8, size: 4, baseType: FIT_UINT32 }, // total_timer_time (scale 1000)
    { fieldNum: 9, size: 4, baseType: FIT_UINT32 }, // total_distance (scale 100)
    { fieldNum: 13, size: 2, baseType: FIT_UINT16 }, // avg_speed (scale 1000)
    { fieldNum: 15, size: 1, baseType: FIT_UINT8 }, // avg_heart_rate
    { fieldNum: 19, size: 2, baseType: FIT_UINT16 }, // avg_power
    { fieldNum: 17, size: 1, baseType: FIT_UINT8 }, // avg_cadence
  ]);

  const savedLaps = [...laps];
  const lastLap = savedLaps.at(-1);
  if (!lastLap || lastLap.endTime < elapsedTime) {
    savedLaps.push(
      summariseLap(
        streams,
        {
          index: savedLaps.length,
          startTime: lastLap?.endTime ?? 0,
          endTime: elapsedTime,
          startIndex: lastLap ? lastLap.endIndex + 1 : 0,
          endIndex: numPoints - 1,
          movingEndTime: timerTime,
        },
        lastLap?.movingEndTime ?? 0
      )
    );
  }
  let movingStart = 0;
  for (const lap of savedLaps) {
    writer.writeDataHeader(2);
    writer.writeUint32(fitStartTime + lap.endTime);
    writer.writeUint32(fitStartTime + lap.startTime);
    writer.writeUint32(Math.round((lap.endTime - lap.startTime) * 1000));
    writer.writeUint32(Math.round(Math.max(0, lap.movingEndTime - movingStart) * 1000));
    movingStart = lap.movingEndTime;
    writer.writeUint32(Math.round(lap.distance * 100));
    writer.writeUint16(Math.min(65535, Math.round(lap.avgSpeed * 1000)));
    writer.writeUint8(lap.avgHeartrate ? Math.min(255, Math.round(lap.avgHeartrate)) : 0xff);
    writer.writeUint16(lap.avgPower ? Math.min(65535, Math.round(lap.avgPower)) : 0xffff);
    writer.writeUint8(lap.avgCadence ? Math.min(255, Math.round(lap.avgCadence)) : 0xff);
  }

  // ── session message (local 3) ──────────────────────────────────────────────
  const avgSpeed = timerTime > 0 ? totalDistance / timerTime : 0;
  const avgHr = hrCount > 0 ? totalHr / hrCount : 0;
  const avgPower = powerCount > 0 ? totalPower / powerCount : 0;
  const avgCadence = cadenceCount > 0 ? totalCadence / cadenceCount : 0;
  const climbing = elevationOver(streams.altitude ?? []);

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
    { fieldNum: 22, size: 2, baseType: FIT_UINT16 }, // total_ascent
    { fieldNum: 23, size: 2, baseType: FIT_UINT16 }, // total_descent
    { fieldNum: 25, size: 1, baseType: FIT_ENUM }, // first_lap_index
    { fieldNum: 26, size: 2, baseType: FIT_UINT16 }, // num_laps
  ]);

  writer.writeDataHeader(3);
  writer.writeUint32(sessionEndTimestamp);
  writer.writeUint32(fitStartTime);
  writer.writeUint32(Math.round(elapsedTime * 1000));
  writer.writeUint32(Math.round(timerTime * 1000));
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
  writer.writeUint16(Math.min(65535, Math.round(climbing.gain)));
  writer.writeUint16(Math.min(65535, Math.round(climbing.loss)));
  writer.writeUint8(0); // first_lap_index
  writer.writeUint16(savedLaps.length);

  // ── activity message (local 4) ─────────────────────────────────────────────
  writer.writeDefinition(4, MESG_ACTIVITY, [
    { fieldNum: 253, size: 4, baseType: FIT_UINT32 }, // timestamp
    { fieldNum: 0, size: 4, baseType: FIT_UINT32 }, // total_timer_time (scale 1000)
    { fieldNum: 1, size: 2, baseType: FIT_UINT16 }, // num_sessions
    { fieldNum: 2, size: 1, baseType: FIT_ENUM }, // type
    { fieldNum: 3, size: 1, baseType: FIT_ENUM }, // event
    { fieldNum: 4, size: 1, baseType: FIT_ENUM }, // event_type
  ]);
  writer.writeDataHeader(4);
  writer.writeUint32(sessionEndTimestamp);
  writer.writeUint32(Math.round(timerTime * 1000));
  writer.writeUint16(1); // num_sessions
  writer.writeUint8(0); // type = manual
  writer.writeUint8(26); // event = activity
  writer.writeUint8(1); // event_type = stop

  const result = writer.toArrayBuffer();
  log.log(`Generated FIT file: ${result.byteLength} bytes, ${numPoints} records`);
  return result;
}
