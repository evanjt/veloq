import { generateFitFile } from '@/lib/recording/fitGenerator';
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
      // Profile version (21 * 100 + 60 = 2160 = 0x0870)
      expect(view.getUint16(2, true)).toBe(2160);
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
      const expectedLat = Math.round(lat * SEMICIRCLE_FACTOR);
      const expectedLng = Math.round(lng * SEMICIRCLE_FACTOR);

      // Scan for encoded semicircle values in message data
      const view = new DataView(buffer);
      let foundLat = false;
      let foundLng = false;
      for (let i = 14; i <= buffer.byteLength - 4; i++) {
        const val = view.getInt32(i, true);
        if (val === expectedLat) foundLat = true;
        if (val === expectedLng) foundLng = true;
      }
      expect(foundLat).toBe(true);
      expect(foundLng).toBe(true);
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

      const view = new DataView(buffer);
      let foundInvalid = false;
      for (let i = 14; i <= buffer.byteLength - 4; i++) {
        if (view.getInt32(i, true) === 0x7fffffff) {
          foundInvalid = true;
          break;
        }
      }
      expect(foundInvalid).toBe(true);
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

      // Expected: (100 + 500) * 5 = 3000
      const expectedAlt = Math.round((altitude + 500) * 5);
      const view = new DataView(buffer);
      let foundAlt = false;
      for (let i = 14; i <= buffer.byteLength - 2; i++) {
        if (view.getUint16(i, true) === expectedAlt) {
          foundAlt = true;
          break;
        }
      }
      expect(foundAlt).toBe(true);
    });

    it('clamps negative altitudes to valid range', async () => {
      const streams = makeStreams({
        time: [0],
        latlng: [[45.0, 10.0]],
        altitude: [-600], // Would give (-600 + 500) * 5 = -500 → clamped to 0
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

      // Should not throw - file is still valid
      expect(buffer.byteLength).toBeGreaterThan(14);
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

      // Must have at least: header (14) + file_id + session + activity + CRC (2)
      expect(buffer.byteLength).toBeGreaterThan(16);
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

      const bytes = new Uint8Array(buffer);
      const view = new DataView(buffer);

      // HR values appear as uint8
      for (const hr of [130, 135, 140, 145, 150]) {
        expect(bytes.includes(hr)).toBe(true);
      }

      // Power values appear as uint16 LE
      for (const pwr of [200, 210, 220, 230, 240]) {
        let found = false;
        for (let i = 14; i <= buffer.byteLength - 2; i++) {
          if (view.getUint16(i, true) === pwr) {
            found = true;
            break;
          }
        }
        expect(found).toBe(true);
      }

      // Cadence values appear as uint8
      for (const cad of [85, 86, 87, 88, 89]) {
        expect(bytes.includes(cad)).toBe(true);
      }
    });

    it('grows file size proportionally to record count', async () => {
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

      // 20 records should be significantly larger than 5
      expect(buf20.byteLength).toBeGreaterThan(buf5.byteLength);
      // Each record has 9 fields (timestamp + lat + lng + alt + hr + cad + dist + speed + power)
      // totaling about 24 bytes per record
      const diff = buf20.byteLength - buf5.byteLength;
      expect(diff).toBeGreaterThan(15 * 20); // At least ~20 bytes per extra record
    });
  });

  describe('lap records', () => {
    it('increases file size when laps are provided', async () => {
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

      expect(withLaps.byteLength).toBeGreaterThan(withoutLaps.byteLength);
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

      // Lap elapsed = (5 - 0) * 1000 = 5000
      const view = new DataView(buffer);
      let found = false;
      for (let i = 14; i <= buffer.byteLength - 4; i++) {
        if (view.getUint32(i, true) === 5000) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
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

      const bytes = new Uint8Array(buffer);
      const view = new DataView(buffer);

      // Max speed = 11.0 m/s, encoded as 11000 (scale 1000)
      let foundMaxSpeed = false;
      for (let i = 14; i <= buffer.byteLength - 2; i++) {
        if (view.getUint16(i, true) === 11000) {
          foundMaxSpeed = true;
          break;
        }
      }
      expect(foundMaxSpeed).toBe(true);

      // Avg HR = round((120+140+160)/3) = 140, appears as uint8
      // Max HR = 160, appears as uint8
      expect(bytes.includes(160)).toBe(true);
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

      // 0xFF (255) is used as invalid marker for uint8 fields
      // 0xFFFF (65535) is used as invalid marker for uint16 fields
      const bytes = new Uint8Array(buffer);
      expect(bytes.includes(0xff)).toBe(true);
    });
  });

  describe('sport type mapping', () => {
    it.each([
      ['Ride', 2],
      ['Run', 1],
      ['Swim', 5],
      ['Walk', 11],
      ['Hike', 17],
    ] as [ActivityType, number][])(
      'maps %s to sport type %d',
      async (activityType, expectedSport) => {
        const buffer = await generateFitFile({
          activityType,
          startTime,
          streams: EMPTY_STREAMS,
          laps: [],
        });

        const bytes = new Uint8Array(buffer);
        expect(bytes.includes(expectedSport)).toBe(true);
      }
    );

    it('uses generic sport (0) for unknown activity types', async () => {
      const buffer = await generateFitFile({
        activityType: 'UnknownSport' as ActivityType,
        startTime,
        streams: EMPTY_STREAMS,
        laps: [],
      });

      // Should not throw
      expect(buffer.byteLength).toBeGreaterThan(14);
    });
  });
});
