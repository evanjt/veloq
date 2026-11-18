/**
 * Scenario: a client in another language reads the link's shapes from `schema.json`, written
 * beside `schema.d.ts` from the same method table and bindings.
 * Expected behaviour: every method's params and result resolve inside the document, the farewell
 * reasons are the engine's, and a reply the demo phone gives for `feed.page` validates against its
 * result under the 2020-12 validator.
 */

import Ajv from 'ajv/dist/2020';
import { execFileSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { engineFarewellReasons } from '../__shared__/farewellReasons';
import { demoResults } from '../__shared__/connectDemoLibrary';

const REPO = join(__dirname, '../../..');
const SCRIPT = join(REPO, 'scripts/generate-link-schema.mjs');
const METHODS = 'web/connect/methods.json';
const BINDINGS = 'modules/veloqrs/src/generated/veloqrs.ts';

let root: string;
let table: {
  protocol: number;
  minProtocol: number;
  methods: { name: string; write: boolean; params: string; result: string }[];
};
let schema: {
  protocol: number;
  minProtocol: number;
  farewells: { $ref: string };
  $defs: Record<string, { enum?: string[] }>;
  methods: {
    name: string;
    write: boolean;
    params: { $ref: string };
    result: { $ref: string };
  }[];
};

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'link-schema-json-'));
  for (const file of [METHODS, BINDINGS]) {
    mkdirSync(join(root, file, '..'), { recursive: true });
    cpSync(join(REPO, file), join(root, file));
  }
  execFileSync('node', [SCRIPT, '--root', root], { stdio: 'pipe' });
  table = JSON.parse(readFileSync(join(root, METHODS), 'utf8'));
  schema = JSON.parse(readFileSync(join(root, 'web/connect/schema.json'), 'utf8'));
});

afterAll(() => rmSync(root, { recursive: true, force: true }));

it('lists every method with a params and result that resolve', () => {
  expect(schema.protocol).toBe(table.protocol);
  expect(schema.minProtocol).toBe(table.minProtocol);
  expect(schema.methods.map((m) => [m.name, m.write])).toEqual(
    table.methods.map((m) => [m.name, m.write])
  );
  for (const method of schema.methods) {
    for (const ref of [method.params.$ref, method.result.$ref]) {
      expect(ref).toMatch(/^#\/\$defs\//);
      expect(schema.$defs[ref.slice('#/$defs/'.length)]).toBeDefined();
    }
  }
});

it('compiles as a 2020-12 document and takes the demo feed page', () => {
  const { $schema, ...document } = schema as typeof schema & { $schema: string };
  expect($schema).toBe('https://json-schema.org/draft/2020-12/schema');
  // The document carries the protocol's own keywords (`protocol`, `units`, `unit`), which a JSON
  // Schema validator ignores by specification, so unknown keywords are not an error here.
  const ajv = new Ajv({ strictSchema: false });
  ajv.addSchema(document, 'link');
  const entry = schema.methods.find((m) => m.name === 'feed.page')!;
  const validate = ajv.getSchema(`link${entry.result.$ref}`)!;
  const reply = JSON.parse(JSON.stringify(demoResults()['feed.page']));
  expect(validate(reply)).toBe(true);
  expect(validate({ ...reply, cards: 'none' })).toBe(false);
});

it('names the farewell reasons the engine declares, in the spelling the line carries', () => {
  const name = schema.farewells.$ref.slice('#/$defs/'.length);
  expect(schema.$defs[name]?.enum).toEqual(engineFarewellReasons());
});
