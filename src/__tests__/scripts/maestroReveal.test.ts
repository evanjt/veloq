/**
 * Scenario: a flow scrolls a tab screen to a card, a chip or a panel and then
 * taps or asserts it. A tap lands on the centre of the target, and the tab bar
 * and the record button float over the bottom of the list, so a target whose
 * centre sits under either sends the tap to the Map tab or the record screen.
 * A fast swipe flings the list on after the swipe ends, so a target the helper
 * has just seen is carried past before the next assertion. A card that mounts a
 * few frames after its screen reads as missing, and scrolling for it carries it
 * past the top once it appears.
 *
 * Expected behaviour: the reveal helper leaves its target on screen, below the
 * top of its list, with its centre above the tab bar and off the record button,
 * on Android and iOS, from below the fold, from low on the screen, from just
 * under the top, and with the record button hidden. Every flow that uses it
 * names the list it scrolls.
 *
 * The real helper runs through a small interpreter of the Maestro commands it
 * uses, against a model of one scrolling list under a header and over the tab
 * bar. `above` and `below` compare top edges, as Maestro's own filters do. A
 * command the model does not know fails the suite.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';

const { loadAll } = require('js-yaml') as { loadAll: (source: string) => unknown[] };

const MAESTRO = resolve(__dirname, '../../../.maestro');
const REVEAL = join(MAESTRO, 'helpers/reveal.yaml');

/** Touch slop: the part of a drag the list does not follow. */
const SLOP = 8;
/** A drag faster than this, in dp per millisecond, carries the list on after it ends. */
const FLING_SPEED = 0.3;
const FAB_OFFSET = 16;
const FAB_SIZE = 56;
const SCREEN_WIDTH = 360;

type Platform = 'Android' | 'iOS';

interface Device {
  platform: Platform;
  height: number;
  /** Top of the list, under the screen header. */
  listTop: number;
  /** Top of the tab bar, which floats over the bottom of the list. */
  tabTop: number;
}

const DEVICES: Record<Platform, Device> = {
  Android: { platform: 'Android', height: 780, listTop: 88, tabTop: 696 },
  iOS: { platform: 'iOS', height: 956, listTop: 140, tabTop: 862 },
};

interface Target {
  id: string;
  /** Screen top at the starting scroll position, in dp. */
  top: number;
  height: number;
  /** Centre across the screen, as a fraction of its width. */
  x?: number;
  /** Hierarchy reads before it mounts. */
  mountsAfterReads?: number;
}

interface Model {
  device: Device;
  list: string;
  fab: boolean;
  target: Target;
  offset: number;
  minOffset: number;
  maxOffset: number;
  reads: number;
  fling: number;
  flingAfterReads: number;
  output: Record<string, unknown>;
}

interface Bounds {
  y: number;
  height: number;
}

type Selector = { id: string; above?: Selector; below?: Selector };
type Command = string | Record<string, unknown>;

function fabTop(model: Model): number {
  return model.device.tabTop - FAB_OFFSET - FAB_SIZE;
}

function targetTop(model: Model): number {
  return model.target.top - model.offset;
}

/** What the hierarchy reports for the target, or nothing when it is off screen. */
function targetBounds(model: Model): Bounds | null {
  const { device, target } = model;
  if (target.mountsAfterReads !== undefined && model.reads <= target.mountsAfterReads) return null;
  const top = targetTop(model);
  const bottom = top + target.height;
  if (device.platform === 'iOS') {
    // iOS reports an element clipped by its list at its unclipped place.
    return top < device.height && bottom > 0 ? { y: top, height: target.height } : null;
  }
  const y = Math.max(top, device.listTop);
  const end = Math.min(bottom, device.height);
  return end > y ? { y, height: end - y } : null;
}

/** One read of the hierarchy: every id on screen with its reported bounds. */
function snapshot(model: Model): Map<string, Bounds> {
  const found = new Map<string, Bounds>();
  found.set(model.list, { y: model.device.listTop, height: model.device.height });
  found.set('bottom-tab-bar', {
    y: model.device.tabTop,
    height: model.device.height - model.device.tabTop,
  });
  if (model.fab) found.set('record-fab', { y: fabTop(model), height: FAB_SIZE });
  const target = targetBounds(model);
  if (target) found.set(model.target.id, target);
  model.reads += 1;
  // A read during a fling sees the frame before the list has finished moving.
  if (model.flingAfterReads > 0) {
    model.flingAfterReads -= 1;
    if (model.flingAfterReads === 0) settle(model);
  }
  return found;
}

function matches(found: Map<string, Bounds>, selector: Selector): boolean {
  const own = found.get(selector.id);
  if (!own) return false;
  for (const [relation, other] of [
    ['above', selector.above],
    ['below', selector.below],
  ] as const) {
    if (!other) continue;
    const anchor = found.get(other.id);
    if (!anchor) return false;
    if (relation === 'above' && !(own.y < anchor.y)) return false;
    if (relation === 'below' && !(own.y > anchor.y)) return false;
  }
  return true;
}

function evaluate(model: Model, env: Record<string, string>, expression: string): unknown {
  const names = ['output', ...Object.keys(env)];
  return new Function(...names, `return (${expression});`)(model.output, ...Object.values(env));
}

/** Resolves every `${...}` in a value, as Maestro does before it runs a command. */
function resolveValue(model: Model, env: Record<string, string>, value: unknown): unknown {
  if (typeof value === 'string') {
    const whole = value.match(/^\$\{([\s\S]*)\}$/);
    if (whole) return evaluate(model, env, whole[1]);
    return value.replace(/\$\{([\s\S]*?)\}/g, (_, expression: string) =>
      String(evaluate(model, env, expression))
    );
  }
  if (Array.isArray(value)) return value;
  if (value && typeof value === 'object') {
    // Nested commands resolve when they run, not when their parent does.
    return Object.fromEntries(
      Object.entries(value).map(([key, inner]) => [
        key,
        key === 'commands' ? inner : resolveValue(model, env, inner),
      ])
    );
  }
  return value;
}

function conditionHolds(model: Model, when: Record<string, unknown>): boolean {
  const needsRead = 'visible' in when || 'notVisible' in when;
  const found = needsRead ? snapshot(model) : new Map<string, Bounds>();
  return Object.entries(when).every(([kind, value]) => {
    if (kind === 'platform') return value === model.device.platform;
    if (kind === 'visible') return matches(found, value as Selector);
    if (kind === 'notVisible') return !matches(found, value as Selector);
    if (kind === 'true') return Boolean(value);
    throw new Error(`unmodelled condition ${kind}`);
  });
}

function settle(model: Model) {
  if (model.fling !== 0) scrollBy(model, model.fling);
  model.fling = 0;
  model.flingAfterReads = 0;
}

function scrollBy(model: Model, distance: number) {
  model.offset = Math.min(model.maxOffset, Math.max(model.minOffset, model.offset + distance));
}

function percent(point: string): [number, number] {
  const [x, y] = point.split(',').map((part) => Number(part.trim().replace('%', '')) / 100);
  return [x, y];
}

function swipe(model: Model, args: { start: string; end: string; duration?: number }) {
  settle(model);
  const { device } = model;
  const [, startY] = percent(args.start);
  const [, endY] = percent(args.end);
  const startDp = startY * device.height;
  // A drag that starts on the header or the tab bar moves no list.
  if (startDp < device.listTop || startDp >= device.tabTop) return;
  const drag = (startY - endY) * device.height;
  const moved = Math.sign(drag) * Math.max(0, Math.abs(drag) - SLOP);
  scrollBy(model, moved);
  const duration = args.duration ?? 400;
  if (Math.abs(drag) / duration > FLING_SPEED) {
    model.fling = moved;
    model.flingAfterReads = 1;
  }
}

function readFlow(file: string): Command[] {
  const documents = loadAll(readFileSync(file, 'utf8'));
  return documents[documents.length - 1] as Command[];
}

function run(model: Model, env: Record<string, string>, commands: Command[]) {
  for (const command of commands) {
    const [name, raw] =
      typeof command === 'string' ? [command, undefined] : Object.entries(command)[0];
    const args = resolveValue(model, env, raw) as Record<string, unknown> | undefined;
    switch (name) {
      case 'evalScript':
        break;
      case 'assertTrue':
        if (!args) throw new Error('Assertion is false: assertTrue');
        break;
      case 'swipe':
        swipe(model, args as { start: string; end: string; duration?: number });
        break;
      case 'waitForAnimationToEnd':
        settle(model);
        break;
      case 'assertVisible':
        if (!matches(snapshot(model), args as Selector)) {
          throw new Error(`Assertion is false: ${JSON.stringify(args)} is visible`);
        }
        break;
      case 'extendedWaitUntil': {
        const wait = args as { visible: Selector; timeout?: number; optional?: boolean };
        const polls = Math.ceil((wait.timeout ?? 17000) / 500);
        let seen = false;
        for (let i = 0; i < polls && !seen; i += 1) seen = matches(snapshot(model), wait.visible);
        if (!seen && !wait.optional) {
          throw new Error(`Assertion is false: ${JSON.stringify(wait.visible)} is visible`);
        }
        break;
      }
      case 'runFlow': {
        const flow = args as { when?: Record<string, unknown>; commands?: Command[] };
        if (flow.when && !conditionHolds(model, flow.when)) break;
        run(model, env, flow.commands ?? []);
        break;
      }
      case 'repeat': {
        const loop = raw as {
          while?: Record<string, unknown>;
          times?: number;
          commands: Command[];
        };
        const times = loop.times ?? Infinity;
        for (let i = 0; i < times; i += 1) {
          if (
            loop.while &&
            !conditionHolds(model, resolveValue(model, env, loop.while) as Record<string, unknown>)
          ) {
            break;
          }
          run(model, env, loop.commands);
        }
        break;
      }
      default:
        throw new Error(`unmodelled Maestro command ${name}`);
    }
  }
}

interface Scene {
  platform: Platform;
  target: Target;
  fab?: boolean;
  list?: string;
  minOffset?: number;
  maxOffset?: number;
}

function reveal(scene: Scene, extra: Record<string, string> = {}): Model {
  const model: Model = {
    device: DEVICES[scene.platform],
    list: scene.list ?? 'home-activity-list',
    fab: scene.fab ?? true,
    target: scene.target,
    offset: 0,
    minOffset: scene.minOffset ?? 0,
    maxOffset: scene.maxOffset ?? 4000,
    reads: 0,
    fling: 0,
    flingAfterReads: 0,
    output: {},
  };
  run(model, { ELEMENT: scene.target.id, LIST: model.list, ...extra }, readFlow(REVEAL));
  settle(model);
  return model;
}

/** Where a tap on the target's centre lands, from where it really is on screen. */
function landing(model: Model): 'target' | 'header' | 'tab bar' | 'record button' {
  const top = targetTop(model);
  const centreY = top + model.target.height / 2;
  const centreX = (model.target.x ?? 0.5) * SCREEN_WIDTH;
  if (top < model.device.listTop) return 'header';
  if (centreY >= model.device.tabTop) return 'tab bar';
  const fabLeft = SCREEN_WIDTH - FAB_OFFSET - FAB_SIZE;
  const onFab =
    centreX >= fabLeft &&
    centreX <= SCREEN_WIDTH - FAB_OFFSET &&
    centreY >= fabTop(model) &&
    centreY <= fabTop(model) + FAB_SIZE;
  return model.fab && onFab ? 'record button' : 'target';
}

const CARD = 240;

describe.each(['Android', 'iOS'] as const)('the reveal helper on %s', (platform) => {
  const { tabTop, listTop } = DEVICES[platform];

  it('brings a card from below the fold to where a tap lands on it', () => {
    const model = reveal({ platform, target: { id: 'card-far', top: 1500, height: CARD } });
    expect(landing(model)).toBe('target');
  });

  it('lifts a card already on screen whose centre sits on the tab bar', () => {
    const model = reveal({ platform, target: { id: 'card-low', top: tabTop - 100, height: CARD } });
    expect(landing(model)).toBe('target');
  });

  it('lifts a card whose top is under the record button', () => {
    const model = reveal({ platform, target: { id: 'card-fab', top: tabTop - 40, height: CARD } });
    expect(landing(model)).toBe('target');
  });

  it('lifts a chip at the right edge of a card off the record button', () => {
    const model = reveal({
      platform,
      target: { id: 'card-chip', top: tabTop - 80, height: 28, x: 0.88 },
    });
    expect(landing(model)).toBe('target');
  });

  it('leaves a chip just under the top of the list on screen', () => {
    const model = reveal({
      platform,
      fab: false,
      list: 'calendar-page',
      target: { id: 'range-chip', top: listTop + 40, height: 32 },
    });
    expect(landing(model)).toBe('target');
  });

  it('waits for a card that mounts after its screen rather than scrolling past it', () => {
    const model = reveal({
      platform,
      fab: false,
      list: 'calendar-page',
      target: { id: 'late-card', top: listTop + 16, height: 360, mountsAfterReads: 2 },
    });
    expect(landing(model)).toBe('target');
  });

  it('clears the tab bar when no record button shows', () => {
    const model = reveal({
      platform,
      fab: false,
      target: { id: 'card-session', top: 1200, height: CARD },
    });
    expect(landing(model)).toBe('target');
  });

  it('scrolls up to a row above the starting position', () => {
    const model = reveal(
      {
        platform,
        minOffset: -56,
        target: { id: 'filter-row', top: listTop - 56, height: 56 },
      },
      { DIRECTION: 'UP' }
    );
    expect(landing(model)).toBe('target');
  });
});

function flowFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return flowFiles(path);
    return name.endsWith('.yaml') ? [path] : [];
  });
}

function revealCalls(node: unknown): Record<string, unknown>[] {
  if (Array.isArray(node)) return node.flatMap(revealCalls);
  if (!node || typeof node !== 'object') return [];
  const record = node as Record<string, unknown>;
  const flow = record.runFlow as { file?: string; env?: Record<string, unknown> } | undefined;
  const own =
    flow && typeof flow === 'object' && flow.file?.endsWith('reveal.yaml') ? [flow.env ?? {}] : [];
  return [...own, ...Object.values(record).flatMap(revealCalls)];
}

describe('flows that use the reveal helper', () => {
  const calls = flowFiles(MAESTRO).flatMap((file) =>
    revealCalls(loadAll(readFileSync(file, 'utf8'))).map((env) => ({
      file: file.slice(MAESTRO.length + 1),
      env,
    }))
  );

  it('exist', () => {
    expect(calls.length).toBeGreaterThan(0);
  });

  it('name the target and the list it scrolls in', () => {
    const missing = calls
      .filter(({ env }) => typeof env.ELEMENT !== 'string' || typeof env.LIST !== 'string')
      .map(({ file }) => file);
    expect(missing).toEqual([]);
  });
});

describe('flows that scroll to an element', () => {
  // A wait for a row below the fold times out before the scroll that would
  // bring it in has run, and the scroll waits for the row on its own.
  it('scroll to it rather than wait for it first', () => {
    const offenders: string[] = [];
    for (const file of flowFiles(MAESTRO)) {
      const commands = readFlow(file);
      if (!Array.isArray(commands)) continue;
      let waited: string | undefined;
      for (const command of commands) {
        if (typeof command !== 'object' || command === null) {
          waited = undefined;
          continue;
        }
        const scroll = command.scrollUntilVisible as { element?: { id?: string } } | undefined;
        const id = scroll?.element?.id;
        if (id && id === waited) offenders.push(`${file.slice(MAESTRO.length + 1)}: ${id}`);
        const wait = command.extendedWaitUntil as { visible?: { id?: string } } | undefined;
        waited = wait?.visible?.id;
      }
    }
    expect(offenders).toEqual([]);
  });
});
