/**
 * Scenario: the payload is built in TypeScript and decoded by Swift in two
 * processes, and a renamed field fails silently as a card that never appears.
 * Expected behaviour: the keys this side writes are exactly the ones the Swift
 * ContentState declares.
 */
import fs from 'fs';
import path from 'path';

import { buildContentState } from '@/features/recording/lib/liveActivity/contentState';

const CONTRACT = path.join(
  __dirname,
  '../../../widget/ios/VeloqWidget/RecordingActivityAttributes.swift'
);

/**
 * Property names declared directly by a struct: `let` lines one level in from the
 * struct's own indent, so a nested type's properties belong to the nested type.
 */
function declaredProperties(swift: string, structName: string): string[] {
  const header = new RegExp(`^([ ]*)(?:public )?struct ${structName}\\b`, 'm');
  const match = header.exec(swift);
  if (!match) throw new Error(`no struct ${structName} in the contract`);

  const indent = ' '.repeat(match[1].length + 2);
  const own = new RegExp(`^${indent}let (\\w+):`, 'gm');
  const closer = new RegExp(`^${match[1]}\\}`, 'm');
  const after = swift.slice(match.index + match[0].length);
  const body = after.slice(0, after.search(closer));
  return [...body.matchAll(own)].map((m) => m[1]);
}

const swift = fs.readFileSync(CONTRACT, 'utf8');

const state = buildContentState({
  status: 'recording',
  now: 1_700_000_600_000,
  startTime: 1_700_000_000_000,
  pausedDurationMs: 0,
  distanceLabel: '12.4 km',
  speedLabel: '28.1 km/h',
  gps: Array.from({ length: 8 }, (_, i) => ({
    latitude: -33.86 + i * 0.001,
    longitude: 151.2 + i * 0.001,
    altitude: null,
    accuracy: null,
    speed: null,
    heading: null,
    timestamp: 0,
  })),
});

describe('live activity payload contract', () => {
  it('writes exactly the fields the Swift ContentState declares', () => {
    expect(Object.keys(state).sort()).toEqual(declaredProperties(swift, 'ContentState').sort());
  });

  it('writes exactly the trace fields the Swift Trace declares', () => {
    expect(state.trace).not.toBeNull();
    expect(Object.keys(state.trace!).sort()).toEqual(declaredProperties(swift, 'Trace').sort());
  });

  it('sends the attributes the Swift side declares, and nothing it cannot decode', () => {
    expect(declaredProperties(swift, 'VeloqRecordingAttributes').sort()).toEqual([
      'activityType',
      'sportCategory',
    ]);
  });
});
