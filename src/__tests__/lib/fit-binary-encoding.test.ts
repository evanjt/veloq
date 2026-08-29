import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import type { RecordingStreams, RecordingLap, ActivityType } from '@/types';

const EMPTY_STREAMS: RecordingStreams = {
  time: [],
  latlng: [],
  altitude: [],
  heartrate: [],
  power: [],
  cadence: [],
  speed: [],
  distance: [],
};

function makeStreams(overrides: Partial<RecordingStreams> = {}): RecordingStreams {
  return { ...EMPTY_STREAMS, ...overrides };
}

// Global message numbers, from the FIT profile.
const MESG_RECORD = 20;
const MESG_LAP = 19;
const MESG_SESSION = 18;

// Field numbers within those messages.
const RECORD_POSITION_LAT = 0;
const RECORD_POSITION_LONG = 1;
const RECORD_ALTITUDE = 2;
const RECORD_ENHANCED_ALTITUDE = 78;
const RECORD_HEART_RATE = 3;
const RECORD_CADENCE = 4;
const RECORD_SPEED = 6;
const RECORD_POWER = 7;
const LAP_TOTAL_ELAPSED = 7;
const LAP_AVG_HEART_RATE = 15;
const SESSION_TOTAL_ELAPSED = 7;
const SESSION_TOTAL_TIMER = 8;
const SESSION_SPORT = 5;
const SESSION_SUB_SPORT = 6;
const SESSION_MAX_SPEED = 15;
const SESSION_AVG_HEART_RATE = 16;
const SESSION_MAX_HEART_RATE = 17;
const SESSION_AVG_POWER = 20;

const INVALID_UINT8 = 0xff;
const INVALID_UINT16 = 0xffff;
const INVALID_SINT32 = 0x7fffffff;

// Record message: 1 header byte plus the eleven fields of the record definition.
const RECORD_MESSAGE_BYTES = 33;

const BASE_TYPE_STRING = 7;
const BASE_TYPE_UINT16 = 132;
const BASE_TYPE_SINT32 = 133;
const BASE_TYPE_UINT32 = 134;

interface DecodedMessage {
  globalMesgNum: number;
  fields: Map<number, number>;
}

function readFieldValue(view: DataView, offset: number, baseType: number): number {
  switch (baseType) {
    case BASE_TYPE_SINT32:
      return view.getInt32(offset, true);
    case BASE_TYPE_UINT32:
      return view.getUint32(offset, true);
    case BASE_TYPE_UINT16:
      return view.getUint16(offset, true);
    default:
      return view.getUint8(offset);
  }
}

/**
 * Decode the message stream so assertions can name a message and a field
 * instead of scanning the file for a byte pattern that may appear anywhere.
 */
function decodeFit(buffer: ArrayBuffer): DecodedMessage[] {
  const view = new DataView(buffer);
  const dataEnd = 14 + view.getUint32(4, true);
  const definitions = new Map<
    number,
    { globalMesgNum: number; fields: { num: number; size: number; baseType: number }[] }
  >();
  const messages: DecodedMessage[] = [];

  let offset = 14;
  while (offset < dataEnd) {
    const header = view.getUint8(offset);
    offset += 1;
    const localType = header & 0x0f;

    if (header & 0x40) {
      offset += 2; // reserved + architecture
      const globalMesgNum = view.getUint16(offset, true);
      offset += 2;
      const fieldCount = view.getUint8(offset);
      offset += 1;
      const fields = [];
      for (let i = 0; i < fieldCount; i++) {
        fields.push({
          num: view.getUint8(offset),
          size: view.getUint8(offset + 1),
          baseType: view.getUint8(offset + 2),
        });
        offset += 3;
      }
      definitions.set(localType, { globalMesgNum, fields });
      continue;
    }

    const definition = definitions.get(localType);
    if (!definition) throw new Error(`data message for undefined local type ${localType}`);

    const fields = new Map<number, number>();
    for (const field of definition.fields) {
      if (field.baseType !== BASE_TYPE_STRING) {
        fields.set(field.num, readFieldValue(view, offset, field.baseType));
      }
      offset += field.size;
    }
    messages.push({ globalMesgNum: definition.globalMesgNum, fields });
  }

  return messages;
}

function messagesOfType(buffer: ArrayBuffer, globalMesgNum: number): DecodedMessage[] {
  return decodeFit(buffer).filter((message) => message.globalMesgNum === globalMesgNum);
}

function onlyMessage(buffer: ArrayBuffer, globalMesgNum: number): DecodedMessage {
  const found = messagesOfType(buffer, globalMesgNum);
  expect(found).toHaveLength(1);
  return found[0];
}

describe('generateFitFile', () => {
  const startTime = new Date('2026-01-15T10:00:00Z');

  describe('FIT header', () => {
    it('generates valid 14-byte header with .FIT signature and protocol 2.0', async () => {
      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      const bytes = new Uint8Array(buffer);
      const view = new DataView(buffer);

      // Header size = 14
      expect(bytes[0]).toBe(14);
      // Protocol version = 0x20 (2.0)
      expect(bytes[1]).toBe(0x20);
      // Profile version (21 * 100 + 133 = 2233)
      expect(view.getUint16(2, true)).toBe(2233);
      // .FIT signature at offset 8-11
      expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe('.FIT');
      // Header CRC at bytes 12-13 (non-zero for valid header)
      expect(view.getUint16(12, true)).not.toBe(0);
    });

    it('encodes data size in header bytes 4-7', async () => {
      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      const view = new DataView(buffer);
      const dataSize = view.getUint32(4, true);
      // Data size = total file size - 14 byte header - 2 byte trailing CRC
      expect(dataSize).toBe(buffer.byteLength - 14 - 2);
    });
  });

  describe('CRC-16', () => {
    it('appends non-zero trailing CRC to file', async () => {
      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      const view = new DataView(buffer);
      const trailingCrc = view.getUint16(buffer.byteLength - 2, true);
      expect(trailingCrc).not.toBe(0);
    });

    it('produces different CRCs for different data', async () => {
      const buffer1 = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      const buffer2 = await generateFitFile({
        activityType: 'Run',
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      const view1 = new DataView(buffer1);
      const view2 = new DataView(buffer2);
      const crc1 = view1.getUint16(buffer1.byteLength - 2, true);
      const crc2 = view2.getUint16(buffer2.byteLength - 2, true);
      expect(crc1).not.toBe(crc2);
    });
  });

  describe('position encoding', () => {
    it('encodes latitude and longitude as semicircles (degrees × 2^31/180)', async () => {
      const lat = 48.8566;
      const lng = 2.3522;
      const streams = makeStreams({
        time: [0],
        latlng: [[lat, lng]],
        altitude: [0],
        heartrate: [0],
        power: [0],
        cadence: [0],
        speed: [0],
        distance: [0],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      const SEMICIRCLE_FACTOR = 2147483648 / 180;
      const record = onlyMessage(buffer, MESG_RECORD);
      expect(record.fields.get(RECORD_POSITION_LAT)).toBe(Math.round(lat * SEMICIRCLE_FACTOR));
      expect(record.fields.get(RECORD_POSITION_LONG)).toBe(Math.round(lng * SEMICIRCLE_FACTOR));
    });

    it('writes invalid marker (0x7FFFFFFF) for zero coordinates', async () => {
      const streams = makeStreams({
        time: [0],
        latlng: [[0, 0]],
        altitude: [0],
        heartrate: [0],
        power: [0],
        cadence: [0],
        speed: [0],
        distance: [0],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      const record = onlyMessage(buffer, MESG_RECORD);
      expect(record.fields.get(RECORD_POSITION_LAT)).toBe(INVALID_SINT32);
      expect(record.fields.get(RECORD_POSITION_LONG)).toBe(INVALID_SINT32);
    });
  });

  describe('altitude encoding', () => {
    it('applies +500 offset and ×5 scale', async () => {
      const altitude = 100;
      const streams = makeStreams({
        time: [0],
        latlng: [[45.0, 10.0]],
        altitude: [altitude],
        heartrate: [0],
        power: [0],
        cadence: [0],
        speed: [0],
        distance: [0],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      const record = onlyMessage(buffer, MESG_RECORD);
      expect(record.fields.get(RECORD_ALTITUDE)).toBe((altitude + 500) * 5);
      expect(record.fields.get(RECORD_ENHANCED_ALTITUDE)).toBe((altitude + 500) * 5);
    });

    it('clamps altitudes below the -500m offset floor to zero', async () => {
      const streams = makeStreams({
        time: [0],
        latlng: [[45.0, 10.0]],
        altitude: [-600], // (-600 + 500) * 5 = -500, below the unsigned floor
        heartrate: [0],
        power: [0],
        cadence: [0],
        speed: [0],
        distance: [0],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      const record = onlyMessage(buffer, MESG_RECORD);
      expect(record.fields.get(RECORD_ALTITUDE)).toBe(0);
      expect(record.fields.get(RECORD_ENHANCED_ALTITUDE)).toBe(0);
    });
  });

  describe('empty streams', () => {
    it('produces valid file with session-only data', async () => {
      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      expect(messagesOfType(buffer, MESG_RECORD)).toHaveLength(0);
      expect(messagesOfType(buffer, MESG_SESSION)).toHaveLength(1);
      const bytes = new Uint8Array(buffer);
      expect(String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11])).toBe('.FIT');
    });
  });

  describe('single-point stream', () => {
    it('produces valid file larger than empty', async () => {
      const singlePointStreams = makeStreams({
        time: [0],
        latlng: [[45.0, 10.0]],
        altitude: [500],
        heartrate: [140],
        power: [200],
        cadence: [90],
        speed: [8.5],
        distance: [0],
      });

      const singleBuffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: singlePointStreams,
        laps: [],
      });

      const emptyBuffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      expect(singleBuffer.byteLength).toBeGreaterThan(emptyBuffer.byteLength);
    });
  });

  describe('full recording with all sensor data', () => {
    it('includes HR, power, cadence, altitude, and speed in records', async () => {
      const streams = makeStreams({
        time: [0, 1, 2, 3, 4],
        latlng: [
          [45.0, 10.0],
          [45.001, 10.001],
          [45.002, 10.002],
          [45.003, 10.003],
          [45.004, 10.004],
        ],
        altitude: [100, 101, 102, 103, 104],
        heartrate: [130, 135, 140, 145, 150],
        power: [200, 210, 220, 230, 240],
        cadence: [85, 86, 87, 88, 89],
        speed: [8.0, 8.2, 8.4, 8.6, 8.8],
        distance: [0, 8.0, 16.2, 24.6, 33.2],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      const records = messagesOfType(buffer, MESG_RECORD);
      expect(records).toHaveLength(5);
      expect(records.map((r) => r.fields.get(RECORD_HEART_RATE))).toEqual([
        130, 135, 140, 145, 150,
      ]);
      expect(records.map((r) => r.fields.get(RECORD_POWER))).toEqual([200, 210, 220, 230, 240]);
      expect(records.map((r) => r.fields.get(RECORD_CADENCE))).toEqual([85, 86, 87, 88, 89]);
      expect(records.map((r) => r.fields.get(RECORD_ALTITUDE))).toEqual([
        3000, 3005, 3010, 3015, 3020,
      ]);
      expect(records.map((r) => r.fields.get(RECORD_SPEED))).toEqual([
        8000, 8200, 8400, 8600, 8800,
      ]);
    });

    it('grows file size by one fixed-width record per point', async () => {
      const make = (n: number) =>
        makeStreams({
          time: Array.from({ length: n }, (_, i) => i),
          latlng: Array.from({ length: n }, (_, i) => [45.0 + i * 0.001, 10.0] as [number, number]),
          altitude: Array.from({ length: n }, () => 100),
          heartrate: Array.from({ length: n }, () => 140),
          power: Array.from({ length: n }, () => 200),
          cadence: Array.from({ length: n }, () => 90),
          speed: Array.from({ length: n }, () => 8.0),
          distance: Array.from({ length: n }, (_, i) => i * 10),
        });

      const buf5 = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: make(5),
        laps: [],
      });

      const buf20 = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: make(20),
        laps: [],
      });

      expect(messagesOfType(buf5, MESG_RECORD)).toHaveLength(5);
      expect(messagesOfType(buf20, MESG_RECORD)).toHaveLength(20);
      expect(buf20.byteLength - buf5.byteLength).toBe(15 * RECORD_MESSAGE_BYTES);
    });
  });

  describe('lap records', () => {
    it('writes one lap message per supplied lap', async () => {
      const streams = makeStreams({
        time: [0, 1, 2, 3],
        latlng: [
          [45.0, 10.0],
          [45.001, 10.001],
          [45.002, 10.002],
          [45.003, 10.003],
        ],
        altitude: [100, 100, 100, 100],
        heartrate: [130, 140, 150, 160],
        power: [200, 210, 220, 230],
        cadence: [85, 90, 95, 88],
        speed: [8.0, 8.5, 9.0, 8.8],
        distance: [0, 8, 16.5, 25.3],
      });

      const laps: RecordingLap[] = [
        {
          index: 0,
          startTime: 0,
          endTime: 2,
          startIndex: 0,
          endIndex: 2,
          movingEndTime: 2,
          distance: 16.5,
          avgSpeed: 8.25,
          avgHeartrate: 135,
          avgPower: 205,
          avgCadence: 87,
        },
        {
          index: 1,
          startTime: 2,
          endTime: 3,
          startIndex: 3,
          endIndex: 3,
          movingEndTime: 3,
          distance: 8.8,
          avgSpeed: 8.8,
          avgHeartrate: 155,
          avgPower: 225,
          avgCadence: 91,
        },
      ];

      const withLaps = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps,
      });

      const withoutLaps = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      expect(messagesOfType(withoutLaps, MESG_LAP)).toHaveLength(0);
      const lapMessages = messagesOfType(withLaps, MESG_LAP);
      expect(lapMessages).toHaveLength(2);
      expect(lapMessages.map((l) => l.fields.get(LAP_AVG_HEART_RATE))).toEqual([135, 155]);
    });

    it('encodes lap elapsed time with ×1000 scale', async () => {
      const streams = makeStreams({
        time: [0, 5],
        latlng: [
          [45.0, 10.0],
          [45.001, 10.0],
        ],
        altitude: [100, 100],
        heartrate: [140, 150],
        power: [200, 220],
        cadence: [90, 92],
        speed: [8.0, 8.5],
        distance: [0, 40],
      });

      const laps: RecordingLap[] = [
        {
          index: 0,
          startTime: 0,
          endTime: 5,
          startIndex: 0,
          endIndex: 1,
          movingEndTime: 5,
          distance: 40,
          avgSpeed: 8.0,
          avgHeartrate: 145,
          avgPower: 210,
          avgCadence: 91,
        },
      ];

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps,
      });

      const lap = onlyMessage(buffer, MESG_LAP);
      expect(lap.fields.get(LAP_TOTAL_ELAPSED)).toBe(5000);
    });
  });

  describe('session message', () => {
    it('contains aggregated metrics (avg HR, max speed, max HR)', async () => {
      const streams = makeStreams({
        time: [0, 1, 2],
        latlng: [
          [45.0, 10.0],
          [45.001, 10.001],
          [45.002, 10.002],
        ],
        altitude: [100, 100, 100],
        heartrate: [120, 140, 160],
        power: [180, 200, 220],
        cadence: [80, 90, 100],
        speed: [7.0, 9.0, 11.0],
        distance: [0, 9.0, 20.0],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      const session = onlyMessage(buffer, MESG_SESSION);
      expect(session.fields.get(SESSION_MAX_SPEED)).toBe(11000);
      expect(session.fields.get(SESSION_AVG_HEART_RATE)).toBe(140);
      expect(session.fields.get(SESSION_MAX_HEART_RATE)).toBe(160);
      expect(session.fields.get(SESSION_AVG_POWER)).toBe(200);
    });

    it('subtracts paused time from total_timer_time but not total_elapsed_time', async () => {
      const streams = makeStreams({
        time: [0, 50, 100],
        latlng: [
          [45.0, 10.0],
          [45.001, 10.001],
          [45.002, 10.002],
        ],
        altitude: [100, 100, 100],
        heartrate: [0, 0, 0],
        power: [0, 0, 0],
        cadence: [0, 0, 0],
        speed: [8.0, 8.0, 8.0],
        distance: [0, 400, 800],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
        pausedTimeSeconds: 40,
      });

      const session = onlyMessage(buffer, MESG_SESSION);
      expect(session.fields.get(SESSION_TOTAL_TIMER)).toBe(60_000);
      expect(session.fields.get(SESSION_TOTAL_ELAPSED)).toBe(100_000);
    });

    it('writes invalid markers when no HR/power data', async () => {
      const streams = makeStreams({
        time: [0, 1],
        latlng: [
          [45.0, 10.0],
          [45.001, 10.0],
        ],
        altitude: [100, 100],
        heartrate: [0, 0],
        power: [0, 0],
        cadence: [0, 0],
        speed: [8.0, 8.0],
        distance: [0, 8.0],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      for (const record of messagesOfType(buffer, MESG_RECORD)) {
        expect(record.fields.get(RECORD_HEART_RATE)).toBe(INVALID_UINT8);
        expect(record.fields.get(RECORD_CADENCE)).toBe(INVALID_UINT8);
        expect(record.fields.get(RECORD_POWER)).toBe(INVALID_UINT16);
      }

      const session = onlyMessage(buffer, MESG_SESSION);
      expect(session.fields.get(SESSION_AVG_HEART_RATE)).toBe(INVALID_UINT8);
      expect(session.fields.get(SESSION_AVG_POWER)).toBe(INVALID_UINT16);
    });
  });

  describe('sport type mapping', () => {
    it.each([
      ['Ride', 2, 0],
      ['VirtualRide', 2, 58],
      ['Run', 1, 0],
      ['TrailRun', 1, 1],
      ['Swim', 5, 0],
      ['Walk', 11, 0],
      ['Hike', 17, 0],
      ['Yoga', 4, 15],
    ] as [ActivityType, number, number][])(
      'maps %s to sport %d / sub-sport %d',
      async (activityType, expectedSport, expectedSubSport) => {
        const buffer = await generateFitFile({
          activityType,
          startTime,
          streams: EMPTY_STREAMS,
          laps: [],
        });

        const session = onlyMessage(buffer, MESG_SESSION);
        expect(session.fields.get(SESSION_SPORT)).toBe(expectedSport);
        expect(session.fields.get(SESSION_SUB_SPORT)).toBe(expectedSubSport);
      }
    );

    it('uses generic sport (0) for unknown activity types', async () => {
      const buffer = await generateFitFile({
        activityType: 'UnknownSport' as ActivityType,
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      const session = onlyMessage(buffer, MESG_SESSION);
      expect(session.fields.get(SESSION_SPORT)).toBe(0);
      expect(session.fields.get(SESSION_SUB_SPORT)).toBe(0);
    });
  });

  describe('NaN in sensor data', () => {
    const base = {
      time: [0, 1, 2],
      latlng: [
        [45.0, 10.0],
        [45.001, 10.001],
        [45.002, 10.002],
      ] as [number, number][],
      power: [200, 210, 220],
      cadence: [85, 86, 87],
      speed: [8.0, 8.2, 8.4],
      distance: [0, 8.0, 16.2],
    };

    it('writes a zeroed altitude rather than NaN bytes', async () => {
      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: makeStreams({ ...base, altitude: [100, NaN, 200], heartrate: [130, 140, 150] }),
        laps: [],
      });

      const records = messagesOfType(buffer, MESG_RECORD);
      expect(records.map((r) => r.fields.get(RECORD_ALTITUDE))).toEqual([3000, 0, 3500]);
      expect(records.map((r) => r.fields.get(RECORD_ENHANCED_ALTITUDE))).toEqual([3000, 0, 3500]);
      expect(records.map((r) => r.fields.get(RECORD_HEART_RATE))).toEqual([130, 140, 150]);
    });

    it('survives an altitude stream that is entirely NaN', async () => {
      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: makeStreams({ ...base, altitude: [NaN, NaN, NaN], heartrate: [130, 140, 150] }),
        laps: [],
      });

      const records = messagesOfType(buffer, MESG_RECORD);
      expect(records.map((r) => r.fields.get(RECORD_ALTITUDE))).toEqual([0, 0, 0]);
    });

    it('treats a NaN heart rate as no reading', async () => {
      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams: makeStreams({
          time: [0, 1],
          latlng: [
            [45.0, 10.0],
            [45.001, 10.001],
          ],
          altitude: [100, 101],
          heartrate: [NaN, 140],
          power: [200, 210],
          cadence: [85, 86],
          speed: [8.0, 8.2],
          distance: [0, 8.0],
        }),
        laps: [],
      });

      const records = messagesOfType(buffer, MESG_RECORD);
      expect(records.map((r) => r.fields.get(RECORD_HEART_RATE))).toEqual([INVALID_UINT8, 140]);
      expect(records.map((r) => r.fields.get(RECORD_ALTITUDE))).toEqual([3000, 3005]);
    });
  });

  describe('missing sensor streams', () => {
    it('falls back to zero altitude when the stream is undefined', async () => {
      const streams = makeStreams({
        time: [0, 1],
        latlng: [
          [45.0, 10.0],
          [45.001, 10.001],
        ],
        altitude: undefined as unknown as number[],
        heartrate: [130, 140],
        power: [200, 210],
        cadence: [85, 86],
        speed: [8.0, 8.2],
        distance: [0, 8.0],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      const records = messagesOfType(buffer, MESG_RECORD);
      expect(records).toHaveLength(2);
      // 0m altitude still carries the +500 offset and ×5 scale.
      expect(records.map((r) => r.fields.get(RECORD_ALTITUDE))).toEqual([2500, 2500]);
    });
  });

  describe('sensor value overflow', () => {
    it('caps heart rate at the uint8 ceiling', async () => {
      const streams = makeStreams({
        time: [0],
        latlng: [[45.0, 10.0]],
        altitude: [100],
        heartrate: [350], // Above uint8 max
        power: [200],
        cadence: [90],
        speed: [8.0],
        distance: [0],
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      const record = onlyMessage(buffer, MESG_RECORD);
      expect(record.fields.get(RECORD_HEART_RATE)).toBe(255);
      expect(onlyMessage(buffer, MESG_SESSION).fields.get(SESSION_MAX_HEART_RATE)).toBe(255);
    });
  });

  describe('large recording', () => {
    it('handles 10,000 data points without crash', async () => {
      const n = 10000;
      const streams = makeStreams({
        time: Array.from({ length: n }, (_, i) => i),
        latlng: Array.from(
          { length: n },
          (_, i) => [45.0 + i * 0.0001, 10.0 + i * 0.0001] as [number, number]
        ),
        altitude: Array.from({ length: n }, (_, i) => 100 + i * 0.1),
        heartrate: Array.from({ length: n }, () => 140),
        power: Array.from({ length: n }, () => 200),
        cadence: Array.from({ length: n }, () => 90),
        speed: Array.from({ length: n }, () => 8.0),
        distance: Array.from({ length: n }, (_, i) => i * 8.0),
      });

      const buffer = await generateFitFile({
        activityType: 'Ride',
        startTime,
        streams,
        laps: [],
      });

      expect(messagesOfType(buffer, MESG_RECORD)).toHaveLength(n);
      expect(buffer.byteLength).toBeGreaterThan(n * RECORD_MESSAGE_BYTES);
    }, 10000); // 10s timeout for large file
  });
});
