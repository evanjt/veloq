/**
 * Scenario: a recording is encoded to FIT and read back with a decoder that
 * knows nothing about how the encoder laid the file out.
 *
 * Expected behaviour: every byte is accounted for. The header validates, the
 * record stream walks cleanly from definition messages to their data messages,
 * the declared data size matches what was consumed, and both CRCs check out.
 *
 * This is deliberately structural rather than offset-based: the encoder is free
 * to reorder or extend fields as long as a decoder can still read the file.
 */

import { generateFitFile } from '@/features/recording/lib/fitGenerator';
import type { RecordingStreams } from '@/types';

const BASE_TYPE_SIZES: Record<number, number> = {
  0x00: 1, // enum
  0x01: 1, // sint8
  0x02: 1, // uint8
  0x83: 2, // sint16
  0x84: 2, // uint16
  0x85: 4, // sint32
  0x86: 4, // uint32
  0x07: 1, // string
  0x88: 4, // float32
  0x89: 8, // float64
  0x0a: 1, // uint8z
  0x8b: 2, // uint16z
  0x8c: 4, // uint32z
  0x0d: 1, // byte
};

interface FieldDefinition {
  fieldNumber: number;
  size: number;
  baseType: number;
}

interface MessageDefinition {
  globalMessageNumber: number;
  littleEndian: boolean;
  fields: FieldDefinition[];
}

interface DataMessage {
  globalMessageNumber: number;
  fields: Map<number, number[]>;
}

interface DecodedFit {
  headerSize: number;
  protocolVersion: number;
  profileVersion: number;
  dataSize: number;
  definitions: MessageDefinition[];
  messages: DataMessage[];
  headerCrc: number;
  fileCrc: number;
}

const CRC_TABLE = [
  0x0000, 0xcc01, 0xd801, 0x1400, 0xf001, 0x3c00, 0x2800, 0xe401, 0xa001, 0x6c00, 0x7800, 0xb401,
  0x5000, 0x9c01, 0x8801, 0x4400,
];

function fitCrc(bytes: Uint8Array, from: number, to: number): number {
  let crc = 0;
  for (let i = from; i < to; i++) {
    let checkByte = bytes[i];
    let tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[checkByte & 0xf];

    tmp = CRC_TABLE[crc & 0xf];
    crc = (crc >> 4) & 0x0fff;
    crc = crc ^ tmp ^ CRC_TABLE[(checkByte >> 4) & 0xf];
  }
  return crc;
}

/**
 * Minimal FIT record-stream reader. Handles the normal-header subset the
 * generator emits: definition messages, data messages, and no compressed
 * timestamps or developer fields.
 */
function decodeFit(buffer: ArrayBuffer): DecodedFit {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const headerSize = bytes[0];
  if (headerSize !== 12 && headerSize !== 14) {
    throw new Error(`unexpected header size ${headerSize}`);
  }
  const signature = String.fromCharCode(bytes[8], bytes[9], bytes[10], bytes[11]);
  if (signature !== '.FIT') {
    throw new Error(`missing .FIT signature, saw "${signature}"`);
  }

  const decoded: DecodedFit = {
    headerSize,
    protocolVersion: bytes[1],
    profileVersion: view.getUint16(2, true),
    dataSize: view.getUint32(4, true),
    definitions: [],
    messages: [],
    headerCrc: headerSize === 14 ? view.getUint16(12, true) : 0,
    fileCrc: view.getUint16(bytes.length - 2, true),
  };

  const definitionsByLocalType = new Map<number, MessageDefinition>();
  const recordsEnd = headerSize + decoded.dataSize;
  let offset = headerSize;

  while (offset < recordsEnd) {
    const recordHeader = bytes[offset];
    offset += 1;

    if (recordHeader & 0x80) {
      throw new Error('compressed timestamp headers are not emitted by the generator');
    }
    const localType = recordHeader & 0x0f;

    if (recordHeader & 0x40) {
      offset += 1; // reserved
      const littleEndian = bytes[offset] === 0;
      offset += 1;
      const globalMessageNumber = view.getUint16(offset, littleEndian);
      offset += 2;
      const fieldCount = bytes[offset];
      offset += 1;

      const fields: FieldDefinition[] = [];
      for (let i = 0; i < fieldCount; i++) {
        fields.push({
          fieldNumber: bytes[offset],
          size: bytes[offset + 1],
          baseType: bytes[offset + 2],
        });
        offset += 3;
      }

      if (recordHeader & 0x20) {
        throw new Error('developer field definitions are not emitted by the generator');
      }

      const definition: MessageDefinition = { globalMessageNumber, littleEndian, fields };
      definitionsByLocalType.set(localType, definition);
      decoded.definitions.push(definition);
      continue;
    }

    const definition = definitionsByLocalType.get(localType);
    if (!definition) {
      throw new Error(`data message for undefined local type ${localType}`);
    }

    const fields = new Map<number, number[]>();
    for (const field of definition.fields) {
      const baseSize = BASE_TYPE_SIZES[field.baseType];
      if (!baseSize) {
        throw new Error(`unknown base type 0x${field.baseType.toString(16)}`);
      }
      if (field.size % baseSize !== 0) {
        throw new Error(`field size ${field.size} is not a multiple of base size ${baseSize}`);
      }

      const values: number[] = [];
      for (let i = 0; i < field.size / baseSize; i++) {
        const at = offset + i * baseSize;
        values.push(readValue(view, at, field.baseType, definition.littleEndian));
      }
      fields.set(field.fieldNumber, values);
      offset += field.size;
    }

    decoded.messages.push({ globalMessageNumber: definition.globalMessageNumber, fields });
  }

  if (offset !== recordsEnd) {
    throw new Error(`record stream overran the declared data size by ${offset - recordsEnd}`);
  }

  return decoded;
}

function readValue(view: DataView, at: number, baseType: number, littleEndian: boolean): number {
  switch (baseType) {
    case 0x00:
    case 0x02:
    case 0x0a:
    case 0x0d:
    case 0x07:
      return view.getUint8(at);
    case 0x01:
      return view.getInt8(at);
    case 0x83:
      return view.getInt16(at, littleEndian);
    case 0x84:
    case 0x8b:
      return view.getUint16(at, littleEndian);
    case 0x85:
      return view.getInt32(at, littleEndian);
    case 0x86:
    case 0x8c:
      return view.getUint32(at, littleEndian);
    case 0x88:
      return view.getFloat32(at, littleEndian);
    case 0x89:
      return view.getFloat64(at, littleEndian);
    default:
      throw new Error(`unhandled base type 0x${baseType.toString(16)}`);
  }
}

const GLOBAL_FILE_ID = 0;
const GLOBAL_RECORD = 20;
const GLOBAL_LAP = 19;
const GLOBAL_SESSION = 18;
const GLOBAL_ACTIVITY = 34;

const SAMPLES = 240;

function rideStreams(): RecordingStreams {
  const time: number[] = [];
  const latlng: [number, number][] = [];
  const altitude: number[] = [];
  const heartrate: number[] = [];
  const power: number[] = [];
  const cadence: number[] = [];
  const speed: number[] = [];
  const distance: number[] = [];

  for (let i = 0; i < SAMPLES; i++) {
    time.push(i);
    latlng.push([46.948 + i * 0.00012, 7.447 + i * 0.00009]);
    altitude.push(540 + Math.sin(i / 30) * 25);
    heartrate.push(Math.round(138 + Math.sin(i / 18) * 14));
    power.push(Math.round(210 + Math.sin(i / 11) * 55));
    cadence.push(Math.round(88 + Math.sin(i / 25) * 6));
    speed.push(7.8 + Math.sin(i / 40) * 1.4);
    distance.push(i * 7.8);
  }

  return { time, latlng, altitude, heartrate, power, cadence, speed, distance } as RecordingStreams;
}

const INPUT = {
  activityType: 'Ride' as const,
  startTime: new Date('2026-03-08T06:30:00Z'),
  streams: rideStreams(),
  laps: [
    {
      index: 0,
      startTime: 0,
      endTime: 120,
      startIndex: 0,
      endIndex: 119,
      movingEndTime: 120,
      distance: 936,
      avgSpeed: 7.8,
      avgHeartrate: 141,
      avgPower: 208,
      avgCadence: 88,
    },
    {
      index: 1,
      startTime: 120,
      endTime: 239,
      startIndex: 120,
      endIndex: 238,
      movingEndTime: 239,
      distance: 928,
      avgSpeed: 7.8,
      avgHeartrate: 145,
      avgPower: 214,
      avgCadence: 89,
    },
  ],
};

describe('FIT round trip', () => {
  it('decodes cleanly from header to trailing CRC', async () => {
    const decoded = decodeFit(await generateFitFile(INPUT));

    expect(decoded.headerSize).toBe(14);
    expect(decoded.protocolVersion).toBe(0x20);
    expect(decoded.dataSize).toBeGreaterThan(0);
    expect(decoded.definitions.length).toBeGreaterThan(0);
    expect(decoded.messages.length).toBeGreaterThan(0);
  });

  it('declares a data size that matches the bytes on disk', async () => {
    const buffer = await generateFitFile(INPUT);
    const decoded = decodeFit(buffer);

    expect(buffer.byteLength).toBe(decoded.headerSize + decoded.dataSize + 2);
  });

  it('carries a header CRC and a file CRC that both verify', async () => {
    const buffer = await generateFitFile(INPUT);
    const bytes = new Uint8Array(buffer);
    const decoded = decodeFit(buffer);

    expect(decoded.headerCrc).toBe(fitCrc(bytes, 0, 12));
    expect(decoded.fileCrc).toBe(fitCrc(bytes, 0, bytes.length - 2));
  });

  it('defines every message type before using it', async () => {
    const decoded = decodeFit(await generateFitFile(INPUT));

    const defined = new Set(decoded.definitions.map((d) => d.globalMessageNumber));
    for (const message of decoded.messages) {
      expect(defined.has(message.globalMessageNumber)).toBe(true);
    }
  });

  it('emits the message types a FIT reader needs to build an activity', async () => {
    const decoded = decodeFit(await generateFitFile(INPUT));
    const counts = new Map<number, number>();
    for (const message of decoded.messages) {
      counts.set(message.globalMessageNumber, (counts.get(message.globalMessageNumber) ?? 0) + 1);
    }

    expect(counts.get(GLOBAL_FILE_ID)).toBe(1);
    expect(counts.get(GLOBAL_SESSION)).toBe(1);
    expect(counts.get(GLOBAL_ACTIVITY)).toBe(1);
    expect(counts.get(GLOBAL_LAP)).toBe(INPUT.laps.length);
    expect(counts.get(GLOBAL_RECORD)).toBe(SAMPLES);
  });

  it('round trips coordinates through semicircles within a metre', async () => {
    const decoded = decodeFit(await generateFitFile(INPUT));
    const records = decoded.messages.filter((m) => m.globalMessageNumber === GLOBAL_RECORD);

    const toDegrees = (semicircles: number) => semicircles * (180 / 2 ** 31);
    records.forEach((record, index) => {
      const [expectedLat, expectedLng] = INPUT.streams.latlng![index];
      expect(toDegrees(record.fields.get(0)![0])).toBeCloseTo(expectedLat, 6);
      expect(toDegrees(record.fields.get(1)![0])).toBeCloseTo(expectedLng, 6);
    });
  });

  it('round trips heart rate and cadence unscaled', async () => {
    const decoded = decodeFit(await generateFitFile(INPUT));
    const records = decoded.messages.filter((m) => m.globalMessageNumber === GLOBAL_RECORD);

    records.forEach((record, index) => {
      expect(record.fields.get(3)![0]).toBe(INPUT.streams.heartrate![index]);
      expect(record.fields.get(4)![0]).toBe(INPUT.streams.cadence![index]);
    });
  });

  it('decodes cleanly for an indoor session with no GPS at all', async () => {
    const buffer = await generateFitFile({
      activityType: 'WeightTraining',
      startTime: new Date('2026-03-08T06:30:00Z'),
      streams: { time: [0, 60, 120], latlng: [] } as unknown as RecordingStreams,
      laps: [],
    });

    const bytes = new Uint8Array(buffer);
    const decoded = decodeFit(buffer);

    expect(decoded.fileCrc).toBe(fitCrc(bytes, 0, bytes.length - 2));
    expect(decoded.messages.some((m) => m.globalMessageNumber === GLOBAL_SESSION)).toBe(true);
    expect(decoded.messages.filter((m) => m.globalMessageNumber === GLOBAL_RECORD)).toHaveLength(3);
  });

  it('decodes cleanly when GPS drops out partway through', async () => {
    const buffer = await generateFitFile({
      activityType: 'Ride',
      startTime: new Date('2026-03-08T06:30:00Z'),
      streams: {
        time: [0, 1, 2, 3, 4],
        latlng: [
          [46.948, 7.447],
          [46.949, 7.448],
        ],
      } as unknown as RecordingStreams,
      laps: [],
    });

    const bytes = new Uint8Array(buffer);
    const decoded = decodeFit(buffer);

    expect(decoded.fileCrc).toBe(fitCrc(bytes, 0, bytes.length - 2));
    expect(decoded.messages.filter((m) => m.globalMessageNumber === GLOBAL_RECORD)).toHaveLength(5);
  });

  it('decodes cleanly for an empty recording', async () => {
    const buffer = await generateFitFile({
      activityType: 'Ride',
      startTime: new Date('2026-03-08T06:30:00Z'),
      streams: { time: [], latlng: [] } as unknown as RecordingStreams,
      laps: [],
    });

    const bytes = new Uint8Array(buffer);
    const decoded = decodeFit(buffer);

    expect(decoded.fileCrc).toBe(fitCrc(bytes, 0, bytes.length - 2));
    expect(decoded.messages.filter((m) => m.globalMessageNumber === GLOBAL_RECORD)).toHaveLength(0);
  });
});
