/**
 * Scenario: the connect page's types are generated from the engine's method
 * table and its generated bindings. A record changed in Rust, or a method
 * added to the table, leaves the page typed against the old shape until the
 * schema is generated again.
 *
 * Expected behaviour: the guard passes a schema the generator wrote and fails
 * one that is older than either input. The generator refuses a method over a
 * shape JSON cannot say, and writes the shapes serde writes: a nullable
 * option, a camelCase variant union, base64 for bytes, a plain object for a map.
 */

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const SCRIPT = join(__dirname, '../../../scripts/generate-link-schema.mjs');
const PRETTIER = join(__dirname, '../../../node_modules/prettier/bin/prettier.cjs');
const PRETTIER_CONFIG = join(__dirname, '../../../config/.prettierrc');
const roots: string[] = [];

afterAll(() => {
  for (const root of roots) rmSync(root, { recursive: true, force: true });
});

const TABLE = {
  protocol: 7,
  methods: [{ name: 'lap.read', params: 'AskLap', result: 'Lap' }],
};

const BINDINGS = `
/**
 * Which lap.
 */
export type AskLap = {
  id: string;
};

/**
 * One lap.
 */
export type Lap = {
  secs: number;
  /**
   * The gear it was ridden in.
   */
  gear?: Gear;
  trace: Uint8Array;
  splits: Float32Array;
  at: /*i64*/ bigint | undefined;
  tags: Map<string, Tag>;
  history: Array<Tag>;
};

export type Tag = {
  label: string;
};

export enum Gear {
  Low,
  HighRatio = 2,
}

export type Count = number;
`;

function tree(table: unknown, bindings: string, schema?: string) {
  const root = mkdtempSync(join(tmpdir(), 'link-schema-'));
  roots.push(root);
  mkdirSync(join(root, 'web/connect'), { recursive: true });
  mkdirSync(join(root, 'modules/veloqrs/src/generated'), { recursive: true });
  writeFileSync(join(root, 'web/connect/methods.json'), JSON.stringify(table));
  writeFileSync(join(root, 'modules/veloqrs/src/generated/veloqrs.ts'), bindings);
  if (schema !== undefined) writeFileSync(join(root, 'web/connect/schema.d.ts'), schema);
  return root;
}

function run(root: string, ...args: string[]): { status: number; output: string } {
  try {
    const output = execFileSync('node', [SCRIPT, '--root', root, ...args], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { status: 0, output };
  } catch (error) {
    const e = error as { status: number; stdout?: string; stderr?: string };
    return { status: e.status, output: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

/** The exit status of `prettier --check` on a file, under the repository's config. */
function prettierCheck(file: string): number {
  try {
    execFileSync('node', [PRETTIER, '--config', PRETTIER_CONFIG, '--check', file], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return 0;
  } catch (error) {
    return (error as { status: number }).status;
  }
}

function generated(table: unknown = TABLE, bindings: string = BINDINGS): string {
  const root = tree(table, bindings);
  expect(run(root).status).toBe(0);
  return readFileSync(join(root, 'web/connect/schema.d.ts'), 'utf8');
}

it('writes the shapes serde writes', () => {
  const schema = generated();
  expect(schema).toContain('protocol 7');
  expect(schema).toContain('  gear: Gear | null;');
  expect(schema).toContain("export type Gear = 'low' | 'highRatio';");
  expect(schema).toContain('  trace: Base64;');
  expect(schema).toContain('  splits: Base64;');
  expect(schema).toContain('  at: number | null;');
  expect(schema).toContain('  tags: Record<string, Tag>;');
  expect(schema).toContain('  history: Tag[];');
  expect(schema).toContain("'lap.read': { params: AskLap; result: Lap };");
  expect(schema).not.toContain('bigint');
  expect(schema).not.toContain('Count');
});

it('copies a record the table names and nothing it does not reach', () => {
  const schema = generated();
  expect(schema).toContain('export type Tag = {');
  expect(schema).toContain(' * Which lap.');
});

it('says a record with no fields as an object with no keys', () => {
  const bindings = `${BINDINGS}\n/**\n * Nothing to ask.\n */\nexport type Empty = {};\n`;
  const schema = generated(
    { protocol: 7, methods: [{ name: 'empty.read', params: 'Empty', result: 'Lap' }] },
    bindings
  );
  expect(schema).toContain('export type Empty = Record<string, never>;');
});

it('writes a schema the repository Prettier config leaves unchanged', () => {
  const bindings = `${BINDINGS}
/**
 * One letter of the alphabet.
 */
export enum Letter {
  Alpha,
  Bravo,
  Charlie,
  Delta,
  Echo,
  Foxtrot,
  Golf,
  Hotel,
  India,
  Juliet,
  Kilo,
  Lima,
}

/**
 * A word spelt in letters.
 */
export type Word = {
  letter: Letter;
};
`;
  const root = tree(
    { protocol: 7, methods: [{ name: 'word.read', params: 'Word', result: 'Word' }] },
    bindings
  );
  expect(run(root).status).toBe(0);
  expect(prettierCheck(join(root, 'web/connect/schema.d.ts'))).toBe(0);
});

it('passes a schema the generator wrote, with the index not a checkout', () => {
  const root = tree(TABLE, BINDINGS, generated());
  expect(run(root, '--check').status).toBe(0);
});

it('fails a schema older than the method table', () => {
  const root = tree(
    {
      ...TABLE,
      methods: [...TABLE.methods, { name: 'lap.list', params: 'AskLap', result: 'Tag' }],
    },
    BINDINGS,
    generated()
  );
  const { status, output } = run(root, '--check');
  expect(status).toBe(1);
  expect(output).toContain('schema.d.ts is older than the method table');
});

it('fails a schema older than a record', () => {
  const root = tree(
    TABLE,
    BINDINGS.replace('secs: number;', 'secs: number;\n  watts: number;'),
    generated()
  );
  expect(run(root, '--check').status).toBe(1);
});

it('fails when there is no schema yet', () => {
  expect(run(tree(TABLE, BINDINGS), '--check').status).toBe(1);
});

it('refuses a method over a record the engine does not declare', () => {
  const root = tree(
    { ...TABLE, methods: [{ name: 'x.y', params: 'Missing', result: 'Lap' }] },
    BINDINGS
  );
  const { status, output } = run(root);
  expect(status).not.toBe(0);
  expect(output).toContain('Missing is not declared');
});

it('refuses an enum that carries data, which serde writes as a tagged object', () => {
  const bindings = `${BINDINGS}\nexport type Wet = InstanceType<typeof Wet>;\n`;
  const root = tree(
    { ...TABLE, methods: [{ name: 'x.y', params: 'AskLap', result: 'Wet' }] },
    bindings
  );
  const { status, output } = run(root);
  expect(status).not.toBe(0);
  expect(output).toContain('Wet');
});
